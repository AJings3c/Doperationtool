package main

// progress.go
// 长任务的进度反馈通用基础设施. 给 dedup / autofix / validator 这种 ~10s+ 后端
// 操作往前端 emit 进度事件, UI 展示百分比 + N/total + elapsed.
//
// 设计要点:
//   - 节流: 100ms 间隔 (或每 N 次循环) 一次, 防止把 wails IPC 桥淹了.
//     在 1.6w 文件里每 op 一次 emit = 4 万次 IPC 渲染, 比任务本身更慢.
//   - 0% 起步 + 100% 收尾必发: 用户开始/结束时一定要看到. 中间节流丢点没关系.
//   - ctx 为 nil (例如单测里 a.ctx 没经 wails 启动赋值) 时整体静默, 不 panic.
//   - 事件名约定: "<biz>:progress", 例如 "dedup:progress" / "autofix:progress" /
//     "validate:progress".

import (
	"context"
	"sync/atomic"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ProgressUpdate 是发往前端的单次进度数据.
//   - Phase: 阶段名, e.g. "scanning" / "moving" / "fixing"  (前端按 phase 切文案)
//   - Current/Total: N/total 计数. Total 为 0 时表示"不定长" (前端走 indeterminate 条)
//   - Percent: 百分比 0..100, 后端算好省得前端再除. Total=0 时为 -1
//   - Label:   人话提示, e.g. "正在搬运 1234/16000"
//   - Elapsed: 已耗时 e.g. "5.2s"
//   - Done:    是否结束 (前端隐藏进度条 / 切换到结果展示)
//   - Cancelled: Done=true 时附带的标记, 区分"正常完成"和"用户取消"
type ProgressUpdate struct {
	Phase     string  `json:"phase"`
	Current   int     `json:"current"`
	Total     int     `json:"total"`
	Percent   float64 `json:"percent"`
	Label     string  `json:"label"`
	Elapsed   string  `json:"elapsed"`
	Done      bool    `json:"done"`
	Cancelled bool    `json:"cancelled,omitempty"`
}

// 默认节流: 100ms 一次, 或每 512 次 tick 一次. 经验值, 1w 文件循环大约会 emit 几十次.
const (
	defaultProgressIntervalMs int64 = 100
	defaultProgressStride     int   = 512
)

// progressEmitter 给一个 emit 调用域共享节流状态. 调用方持有, 每次循环里调 tick(),
// 关键位置 (开始 / 切阶段 / 结束) 调 force 类方法.
//
// 用法:
//
//	pe := newProgressEmitter(a.ctx, "dedup:progress", "moving", total)
//	defer pe.finish("移动完成")
//	for i, p := range paths {
//	    // ... do work ...
//	    pe.tick(i+1, fmt.Sprintf("%d/%d", i+1, total))
//	}
type progressEmitter struct {
	ctx       context.Context
	event     string
	phase     string
	total     int
	startTime time.Time
	// 节流: lastEmitMs 是上次 EventsEmit 的 unix ms. atomic 留给跨 goroutine
	// (validator 的 elapsed-ticker 用得到).
	lastEmitMs    atomic.Int64
	minIntervalMs int64
	tickStride    int
	tickCount     int
}

func newProgressEmitter(ctx context.Context, event, phase string, total int) *progressEmitter {
	pe := &progressEmitter{
		ctx:           ctx,
		event:         event,
		phase:         phase,
		total:         total,
		startTime:     time.Now(),
		minIntervalMs: defaultProgressIntervalMs,
		tickStride:    defaultProgressStride,
	}
	pe.emit(0, "", true) // 0% 起步必发
	return pe
}

// tick 报告"已完成到第 current 个" + 可选 label. 内部决定要不要真 emit.
// 节流逻辑: 自上次 emit > 100ms 或 累计 tick 数到达 stride 倍数时 emit.
func (pe *progressEmitter) tick(current int, label string) {
	pe.tickCount++
	nowMs := time.Now().UnixMilli()
	last := pe.lastEmitMs.Load()
	intervalReached := last == 0 || nowMs-last >= pe.minIntervalMs
	strideReached := pe.tickStride > 0 && pe.tickCount%pe.tickStride == 0
	if !intervalReached && !strideReached {
		return
	}
	pe.emit(current, label, false)
}

// forceEmit 不走节流, 直接发 (给 "切阶段前刷新最后状态" 这种用).
func (pe *progressEmitter) forceEmit(current int, label string) {
	pe.emit(current, label, true)
}

// finish 发 Done=true 的终止事件. label 为空时用默认.
// 内部根据 ctx 状态自动判断 Cancelled: ctx.Err() == context.Canceled 时打上标记 +
// 改写 label 为 "已取消".
func (pe *progressEmitter) finish(label string) {
	cancelled := pe.ctx != nil && pe.ctx.Err() == context.Canceled
	if cancelled {
		label = "已取消"
	} else if label == "" {
		label = "完成"
	}
	pu := ProgressUpdate{
		Phase:     pe.phase,
		Current:   pe.total,
		Total:     pe.total,
		Percent:   100,
		Label:     label,
		Elapsed:   time.Since(pe.startTime).Truncate(100 * time.Millisecond).String(),
		Done:      true,
		Cancelled: cancelled,
	}
	pe.send(pu)
}

// switchPhase 切阶段, 保留同一 emitter (startTime / event 不变, total 重置).
// 给"扫描完接着改"这种连续场景用. 调用后新 phase 的 0% 立刻 emit.
func (pe *progressEmitter) switchPhase(newPhase string, newTotal int) {
	pe.phase = newPhase
	pe.total = newTotal
	pe.tickCount = 0
	pe.emit(0, "", true)
}

// emit 真正调 EventsEmit. force=true 跳过节流, 但仍然更新 lastEmitMs.
func (pe *progressEmitter) emit(current int, label string, force bool) {
	_ = force
	pe.lastEmitMs.Store(time.Now().UnixMilli())
	pu := ProgressUpdate{
		Phase:   pe.phase,
		Current: current,
		Total:   pe.total,
		Label:   label,
		Elapsed: time.Since(pe.startTime).Truncate(100 * time.Millisecond).String(),
	}
	if pe.total > 0 {
		pu.Percent = float64(current) / float64(pe.total) * 100
		if pu.Percent > 100 {
			pu.Percent = 100
		}
	} else {
		pu.Percent = -1 // indeterminate
	}
	pe.send(pu)
}

// send 丢给 wails event bus. wails 的 EventsEmit 内部用 ctx.Value("frontend") 取
// events 总线, 拿不到时直接 log.Fatal 掉进程 (见 wails runtime.go getEvents).
// 这里先用同一个 key 探测, 没有就静默 (单测 / 没经 wails 启动的场景).
func (pe *progressEmitter) send(pu ProgressUpdate) {
	if pe.ctx == nil || pe.ctx.Value("frontend") == nil {
		return
	}
	wruntime.EventsEmit(pe.ctx, pe.event, pu)
}
