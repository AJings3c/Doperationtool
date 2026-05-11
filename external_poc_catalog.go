package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func (a *App) ClassifyExternalPocsByDDDD(projectRoot, sourceDir string) (*FingerprintPocCatalogResult, error) {
	start := time.Now()
	root := strings.TrimSpace(projectRoot)
	source := strings.TrimSpace(sourceDir)
	if root == "" {
		return nil, fmt.Errorf("dddd 根目录为空")
	}
	if source == "" {
		return nil, fmt.Errorf("外部 POC 目录为空")
	}
	if info, err := os.Stat(root); err != nil {
		return nil, fmt.Errorf("dddd 根目录不可访问: %v", err)
	} else if !info.IsDir() {
		return nil, fmt.Errorf("dddd 根目录不是目录: %s", root)
	}
	if info, err := os.Stat(source); err != nil {
		return nil, fmt.Errorf("外部 POC 目录不可访问: %v", err)
	} else if !info.IsDir() {
		return nil, fmt.Errorf("外部 POC 路径不是目录: %s", source)
	}
	fingerPath := filepath.Join(root, "common", "config", "finger.yaml")
	workflowPath := filepath.Join(root, "common", "config", "workflow.yaml")
	if _, statErr := os.Stat(fingerPath); statErr != nil {
		return nil, fmt.Errorf("缺少 dddd 指纹路径 %s: %v", fingerPath, statErr)
	}

	ctx, pe, cleanup := a.beginTask("fingerprint:external_poc_catalog:progress", "scanning", 0)
	defer cleanup()
	defer pe.finish("外部 POC 归类完成")

	pe.forceEmit(0, "读取 dddd finger.yaml")
	fingers, err := loadFingerEntries(ctx, fingerPath)
	if err != nil {
		return nil, err
	}
	workflows := []workflowEntry{}
	if _, statErr := os.Stat(workflowPath); statErr == nil {
		pe.forceEmit(0, "读取 dddd workflow.yaml")
		workflows, err = loadWorkflowEntries(ctx, workflowPath)
		if err != nil {
			return nil, err
		}
	}
	pe.forceEmit(0, "扫描外部 POC")
	pocs, err := scanFingerprintPocs(ctx, pe, source)
	if err != nil {
		return nil, err
	}
	if ctx.Err() != nil {
		return nil, fmt.Errorf("已取消")
	}

	pe.switchPhase("deduping", len(pocs))
	pe.forceEmit(0, fmt.Sprintf("外部 POC 去重: %d 个文件", len(pocs)))
	unique, duplicates := dedupeFingerprintPocs(pocs)
	pe.switchPhase("analyzing", len(unique))
	pe.forceEmit(0, fmt.Sprintf("按产品指纹归类 %d 个唯一 POC", len(unique)))
	res := buildFingerprintPocCatalog(root, fingerPath, workflowPath, source, fingers, workflows, unique, pe)
	res.SourceType = "external"
	res.SourceDir = source
	res.PocFileCount = len(pocs)
	res.UniquePocCount = len(unique)
	res.DuplicatePocCount = len(duplicates)
	res.DuplicatePocs = duplicates
	res.Elapsed = time.Since(start).Truncate(10 * time.Millisecond).String()
	return res, nil
}

func dedupeFingerprintPocs(pocs []FingerprintPocInfo) ([]FingerprintPocInfo, []FingerprintPocDuplicate) {
	seen := map[string]FingerprintPocInfo{}
	unique := make([]FingerprintPocInfo, 0, len(pocs))
	duplicates := []FingerprintPocDuplicate{}
	for _, p := range pocs {
		key, reason := fingerprintPocDedupeKey(p)
		if key == "" {
			key = "path:" + strings.ToLower(p.RelPath)
			reason = "路径兜底"
		}
		if kept, ok := seen[key]; ok {
			duplicates = append(duplicates, FingerprintPocDuplicate{Key: key, Reason: reason, KeptPath: kept.Path, KeptRelPath: kept.RelPath, DuplicatePath: p.Path, DuplicateRelPath: p.RelPath})
			continue
		}
		seen[key] = p
		unique = append(unique, p)
	}
	sortFingerprintPocInfos(unique)
	sort.Slice(duplicates, func(i, j int) bool {
		if duplicates[i].Key == duplicates[j].Key {
			return duplicates[i].DuplicateRelPath < duplicates[j].DuplicateRelPath
		}
		return duplicates[i].Key < duplicates[j].Key
	})
	return unique, duplicates
}

func fingerprintPocDedupeKey(p FingerprintPocInfo) (string, string) {
	if p.ID != "" {
		return "id:" + normalizePocAuditKey(p.ID), "POC id 重复"
	}
	if p.ContentHash != "" {
		return "sha1:" + p.ContentHash, "内容哈希重复"
	}
	base := normalizePocAuditKey(strings.TrimSuffix(p.Name, filepath.Ext(p.Name)))
	if base != "" {
		return "name:" + base, "文件名重复"
	}
	return "", ""
}
