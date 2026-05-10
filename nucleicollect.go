package main

// nucleicollect.go — YAML 采集 (按产品 / 漏洞编号体系自动分桶).
//
// 跟 nucleiclassify.go 的区别:
//   classify: 通用 token-anchor 合并, 不关心 token 是不是产品, 输出 ProposedCategory[]
//             (用于已经按厂商命名的 nuclei 模板库, e.g. adobe / adobecq → adobe)
//   collect:  优先识别"产品名" (内置 ~150 个常见产品词表), 命中→桶名是产品;
//             没产品但有 CVE/CNVD 等漏洞编号 → 按 "前缀-年份" (如 CVE-2021) 分桶;
//             啥都没有 → 落 token-anchor (跟 classify 同算法但放最低优先级).
//             更适合"一坨杂 yaml" — 文件名/id 形态混乱, 既有 wordpress-xxx.yaml 也有
//             CVE-2021-44228.yaml 也有 my-test.yaml — 这种场景下 classify 会按 token
//             无脑分散一片, collect 能聚成几个干净的桶.
//
// 算法:
//   1. walk + extractTopLevelId (复用 nucleiautofix.go 的)
//   2. 对每个 (filename, id) tokenize → 全小写 token 序列
//   3. 优先级桶: product → vuln-id → token (anchor 合并) → uncategorized
//   4. ScanYamlCollection 输出 CollectGroup[], Apply 复用 classify 的 applyAssignmentsInternal

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// CollectFile 单个 yaml 文件在采集视图里的表现.
type CollectFile struct {
	Path       string `json:"path"`
	RelPath    string `json:"relPath"`
	Name       string `json:"name"`
	Id         string `json:"id"`
	Bucket     string `json:"bucket"`     // 最终落到的分类名, e.g. "wordpress" / "CVE-2021"
	BucketKind string `json:"bucketKind"` // "product" / "vuln-id" / "token" / "uncategorized"
	Size       int64  `json:"size"`
}

// CollectGroup 一个分类组. UI 上一个卡片.
type CollectGroup struct {
	Name  string        `json:"name"`  // 分类名 (会做 sanitization, 直接用作目录名)
	Kind  string        `json:"kind"`  // "product" / "vuln-id" / "token"
	Files []CollectFile `json:"files"` // 该组文件 (按 Path 升序)
}

// CollectScanResult 扫描结果.
type CollectScanResult struct {
	Folder string `json:"folder"`
	Total  int    `json:"total"` // 扫到的 yaml 总数
	// Groups 排序: kind 优先级 (product > vuln-id > token), 同 kind 内按文件数降序.
	Groups        []CollectGroup `json:"groups"`
	Uncategorized []CollectFile  `json:"uncategorized"`
	Elapsed       string         `json:"elapsed"`
}

// knownProducts: token (全小写) → 桶名 (规范化的产品名).
// 别名 (e.g. wp → wordpress, k8s → kubernetes) 让一组同义词归到同一个桶.
// 词表选取: 安全圈高频出现的 web/中间件/CMS/OA/数据库/路由器厂商. 不求全, 求高命中率.
var knownProducts = map[string]string{
	// CMS / 博客
	"wordpress": "wordpress", "wp": "wordpress",
	"drupal": "drupal", "joomla": "joomla", "ghost": "ghost",
	"magento": "magento", "prestashop": "prestashop", "opencart": "opencart",
	"typecho": "typecho", "dedecms": "dedecms",
	"ecshop": "ecshop", "phpcms": "phpcms", "discuz": "discuz",
	"emlog": "emlog", "zblog": "zblog", "halo": "halo", "wuzhicms": "wuzhicms",
	"yzmcms": "yzmcms", "metinfo": "metinfo", "jeecms": "jeecms",
	// Java 中间件
	"weblogic": "weblogic", "websphere": "websphere",
	"jboss": "jboss", "tomcat": "tomcat", "jetty": "jetty", "resin": "resin",
	"glassfish": "glassfish",
	// Java 框架
	"struts": "struts", "struts2": "struts", "spring": "spring", "springboot": "spring",
	"shiro": "shiro", "fastjson": "fastjson", "log4j": "log4j", "log4j2": "log4j",
	"hibernate": "hibernate", "dubbo": "dubbo",
	// PHP 框架 / 应用
	"thinkphp": "thinkphp", "tp": "thinkphp",
	"laravel": "laravel", "yii": "yii", "codeigniter": "codeigniter",
	"phpmyadmin": "phpmyadmin", "phpunit": "phpunit",
	// Web 服务器
	"apache": "apache", "httpd": "apache", "nginx": "nginx", "iis": "iis",
	"lighttpd": "lighttpd", "caddy": "caddy", "haproxy": "haproxy", "traefik": "traefik",
	"openresty": "openresty",
	// DevOps / SCM / Issue
	"gitlab": "gitlab", "gitea": "gitea", "gogs": "gogs", "bitbucket": "bitbucket",
	"jira": "jira", "confluence": "confluence", "redmine": "redmine",
	"jenkins": "jenkins", "nexus": "nexus", "sonarqube": "sonarqube",
	"harbor": "harbor", "rancher": "rancher",
	// 大厂 / 云
	"vmware": "vmware", "vcenter": "vmware", "vsphere": "vmware", "esxi": "vmware",
	"oracle": "oracle", "microsoft": "microsoft",
	"ibm": "ibm", "sap": "sap", "salesforce": "salesforce",
	"adobe": "adobe", "atlassian": "atlassian",
	"aws": "aws", "azure": "azure", "gcp": "gcp",
	"alibaba": "alibaba", "aliyun": "alibaba",
	"tencent": "tencent", "baidu": "baidu", "huaweicloud": "huawei",
	// 安全/网关
	"citrix": "citrix", "fortinet": "fortinet", "fortigate": "fortinet", "fortios": "fortinet",
	"paloalto": "paloalto", "panos": "paloalto",
	"sophos": "sophos", "f5": "f5", "bigip": "f5",
	"checkpoint": "checkpoint", "watchguard": "watchguard", "barracuda": "barracuda",
	"cisco": "cisco", "juniper": "juniper", "asa": "cisco",
	// 路由 / 网络设备
	"dlink": "dlink", "tplink": "tplink", "huawei": "huawei", "zte": "zte",
	"mikrotik": "mikrotik", "ubiquiti": "ubiquiti", "netgear": "netgear",
	"asus": "asus", "linksys": "linksys", "ruijie": "ruijie", "h3c": "h3c",
	// 监控 / IPC / 国产安防 (高频出现, 文件名常见 hikvision-xxx / dahua-xxx)
	"hikvision": "hikvision", "海康": "hikvision", "海康威视": "hikvision",
	"dahua": "dahua", "大华": "dahua",
	"uniview": "uniview", "宇视": "uniview",
	"kedacom": "kedacom", "科达": "kedacom",
	"tiandy": "tiandy", "天地伟业": "tiandy",
	"axis": "axis", "panasonic": "panasonic", "samsung": "samsung",
	"bosch": "bosch", "sony": "sony", "honeywell": "honeywell",
	// 数据库
	"mysql": "mysql", "postgres": "postgres", "postgresql": "postgres",
	"mongodb": "mongodb", "mongo": "mongodb", "redis": "redis",
	"mssql": "mssql", "elasticsearch": "elasticsearch", "elastic": "elasticsearch",
	"clickhouse": "clickhouse", "mariadb": "mariadb", "couchdb": "couchdb",
	"influxdb": "influxdb",
	// OA / ERP / 国产
	"ofcms": "ofcms", "fanwei": "fanwei", "weaver": "fanwei", "ecology": "fanwei",
	"yongyou": "yongyou", "u8": "yongyou", "kingdee": "kingdee",
	"seeyon": "seeyon", "tongda": "tongda", "tongdaoa": "tongda",
	"landray": "landray", "yonyou": "yongyou", "ruoyi": "ruoyi",
	// 监控 / 数据
	"druid": "druid", "kibana": "kibana", "grafana": "grafana", "prometheus": "prometheus",
	"zabbix": "zabbix", "nagios": "nagios", "cacti": "cacti",
	// MQ / 协调
	"rabbitmq": "rabbitmq", "kafka": "kafka", "zookeeper": "zookeeper",
	"rocketmq": "rocketmq", "activemq": "activemq",
	// 容器 / 编排
	"docker": "docker", "kubernetes": "kubernetes", "k8s": "kubernetes",
	"openshift": "openshift", "consul": "consul", "etcd": "etcd",
	"nomad": "nomad", "vagrant": "vagrant",
	// 其他
	"swagger": "swagger", "graphql": "graphql",
	"phpstudy": "phpstudy", "xampp": "xampp", "wamp": "wampserver",
	"solr": "solr", "lucene": "solr",
	"openldap": "openldap", "samba": "samba", "smb": "samba",
	"vsftpd": "vsftpd", "proftpd": "proftpd",
	"openssh": "openssh", "openvpn": "openvpn",
	"webmin": "webmin", "cpanel": "cpanel", "plesk": "plesk",
	"ueditor": "ueditor", "kindeditor": "kindeditor", "ckeditor": "ckeditor",
}

// vulnPrefixes: 漏洞编号体系前缀. token 命中时归 "vuln-id" 桶, 紧邻 4 位数年份会做
// "前缀-年份" 子分桶 (CVE-2021), 否则只用前缀 (CVE).
// 用 slice 而不是 map: 数量小, 顺序在 classifyOneFile 里需要稳定优先级.
var vulnPrefixes = []string{"cve", "cnvd", "cnnvd", "ghsa", "msrc", "kev", "qid", "wpvdb", "edb"}

// tokenSplitRe 拆 token: 按 - _ . 空白 / 反斜杠 (windows path), 全小写.
var tokenSplitRe = regexp.MustCompile(`[-_./\s\\]+`)

func tokenizeForCollect(s string) []string {
	if s == "" {
		return nil
	}
	parts := tokenSplitRe.Split(strings.ToLower(strings.TrimSpace(s)), -1)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if len(p) >= 2 {
			out = append(out, p)
		}
	}
	return out
}

// isAllDigit 纯数字判定 (年份 / 版本号检查用, regexp 太重).
func isAllDigit(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// classifyOneFile 给单个 yaml 文件分桶.
//
// 优先级:
//  1. product (knownProducts 命中) — "wordpress-rce.yaml" → wordpress
//  2. vuln-id (CVE/CNVD/...) — "cve-2021-44228.yaml" → CVE-2021
//     无年份: "cve-no-num.yaml" → CVE
//  3. token-anchor — fallback, 取首个 ≥3 字符且非纯数字的 token
//  4. uncategorized — 啥都没匹配上
//
// 注意: 这里只处理单文件; 后面 ScanYamlCollection 还要做组间合并 + 排序.
func classifyOneFile(filename, id string) (bucket, kind string) {
	// 文件名先剥扩展, 让 "log4j-rce.yaml" 拆出来不带 yaml token
	stem := filename
	if ext := strings.ToLower(filepath.Ext(stem)); ext == ".yaml" || ext == ".yml" {
		stem = strings.TrimSuffix(stem, ext)
	}
	tokens := tokenizeForCollect(stem)
	if id != "" {
		tokens = append(tokens, tokenizeForCollect(id)...)
	}

	// 1. product (优先, 因为产品是最有意义的分类轴)
	for _, t := range tokens {
		if name, ok := knownProducts[t]; ok {
			return name, "product"
		}
	}

	// 2. 漏洞编号: 找首个 vuln-id 前缀, 紧邻数字 → 年份子桶
	for i, t := range tokens {
		for _, vp := range vulnPrefixes {
			if t != vp {
				continue
			}
			// 紧邻找 4 位数年份 (1990-2099 范围实际更宽松, 这里只看长度+全数字)
			if i+1 < len(tokens) {
				if y := tokens[i+1]; len(y) == 4 && isAllDigit(y) {
					return strings.ToUpper(vp) + "-" + y, "vuln-id"
				}
			}
			return strings.ToUpper(vp), "vuln-id"
		}
	}

	// 3. fallback: 首个有意义 token
	for _, t := range tokens {
		if len(t) >= 3 && !isAllDigit(t) {
			return t, "token"
		}
	}

	return "", "uncategorized"
}

// ScanYamlCollection 扫描一个目录下所有 yaml, 按产品 / 漏洞编号 / token 分桶.
//
// 限额跟其他扫描一致 (maxFixFiles), skipDirNames 用同一份. 只读, 不动任何文件.
//
// 进度: "collect:progress" event, scanning indeterminate + analyzing total=已知.
func (a *App) ScanYamlCollection(folder string) (*CollectScanResult, error) {
	start := time.Now()
	if strings.TrimSpace(folder) == "" {
		return nil, fmt.Errorf("目录为空")
	}
	info, err := os.Stat(folder)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("不是目录: %s", folder)
	}

	ctx, pe, cleanup := a.beginTask("collect:progress", "scanning", 0)
	defer cleanup()
	defer pe.finish("扫描完成")

	type rawFile struct {
		path    string
		name    string
		relPath string
		id      string
		size    int64
	}
	var files []rawFile
	werr := filepath.WalkDir(folder, func(path string, d os.DirEntry, walkErr error) error {
		if ctx.Err() != nil {
			return filepath.SkipAll
		}
		if walkErr != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			if _, skip := skipDirNames[name]; skip {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if ext != ".yaml" && ext != ".yml" {
			return nil
		}
		if len(files) >= maxFixFiles {
			return filepath.SkipAll
		}
		raw, rerr := os.ReadFile(path)
		var id string
		var sz int64
		if rerr == nil {
			id = extractTopLevelId(string(raw))
			sz = int64(len(raw))
		}
		rel, rrErr := filepath.Rel(folder, path)
		if rrErr != nil {
			rel = path
		}
		files = append(files, rawFile{
			path:    path,
			name:    d.Name(),
			relPath: rel,
			id:      id,
			size:    sz,
		})
		pe.tick(len(files), fmt.Sprintf("已扫描 %d 个 yaml", len(files)))
		return nil
	})
	if werr != nil {
		return nil, werr
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	pe.switchPhase("analyzing", len(files))

	// 排序让结果稳定
	sort.Slice(files, func(i, j int) bool { return files[i].path < files[j].path })

	res := &CollectScanResult{
		Folder: folder,
		Total:  len(files),
	}

	// 分桶
	type bucketAcc struct {
		name  string
		kind  string
		files []CollectFile
	}
	buckets := make(map[string]*bucketAcc) // key = kind + "::" + name 让同名不同 kind 不撞
	for i, f := range files {
		if i%512 == 0 {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			pe.tick(i+1, fmt.Sprintf("已分类 %d/%d", i+1, len(files)))
		}
		bucket, kind := classifyOneFile(f.name, f.id)
		cf := CollectFile{
			Path:       f.path,
			RelPath:    f.relPath,
			Name:       f.name,
			Id:         f.id,
			Bucket:     bucket,
			BucketKind: kind,
			Size:       f.size,
		}
		if kind == "uncategorized" {
			res.Uncategorized = append(res.Uncategorized, cf)
			continue
		}
		key := kind + "::" + bucket
		acc := buckets[key]
		if acc == nil {
			acc = &bucketAcc{name: bucket, kind: kind}
			buckets[key] = acc
		}
		acc.files = append(acc.files, cf)
	}

	// 物化 + 排序: kind 优先级 (product > vuln-id > token), 同 kind 内按文件数降序,
	// 同文件数按 name 升序; 这样 UI 上重要的产品桶永远靠前.
	kindRank := map[string]int{"product": 0, "vuln-id": 1, "token": 2}
	groups := make([]CollectGroup, 0, len(buckets))
	for _, b := range buckets {
		// 桶内文件按 path 排序, 让选中/反选语义稳定
		sort.Slice(b.files, func(i, j int) bool { return b.files[i].Path < b.files[j].Path })
		groups = append(groups, CollectGroup{Name: b.name, Kind: b.kind, Files: b.files})
	}
	sort.Slice(groups, func(i, j int) bool {
		ri, rj := kindRank[groups[i].Kind], kindRank[groups[j].Kind]
		if ri != rj {
			return ri < rj
		}
		if len(groups[i].Files) != len(groups[j].Files) {
			return len(groups[i].Files) > len(groups[j].Files)
		}
		return groups[i].Name < groups[j].Name
	})
	res.Groups = groups
	res.Elapsed = time.Since(start).Truncate(time.Millisecond).String()
	return res, nil
}

// ApplyYamlCollection 把 (bucket → paths) 真实搬迁到 targetDir/<bucket>/.
// 完全复用 classify 的搬迁实现 (applyAssignmentsInternal), 只换 progress event 名字
// 让前端进度卡片标题区分 "采集应用".
//
// 请求结构跟 classify 一样, 因为 (Name, Paths) 语义完全相同.
func (a *App) ApplyYamlCollection(req ApplyCategoriesRequest) (*ApplyCategoriesResult, error) {
	return a.applyAssignmentsInternal(req, "collect:progress")
}
