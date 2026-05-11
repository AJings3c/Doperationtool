export namespace main {

	export class CategoryAssignment {
	    name: string;
	    paths: string[];

	    static createFrom(source: any = {}) {
	        return new CategoryAssignment(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.paths = source["paths"];
	    }
	}
	export class ApplyCategoriesRequest {
	    targetDir: string;
	    assignments: CategoryAssignment[];
	    dryRun: boolean;
	    onConflict: string;

	    static createFrom(source: any = {}) {
	        return new ApplyCategoriesRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.targetDir = source["targetDir"];
	        this.assignments = this.convertValues(source["assignments"], CategoryAssignment);
	        this.dryRun = source["dryRun"];
	        this.onConflict = source["onConflict"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApplyResult {
	    srcPath: string;
	    dstPath: string;
	    category: string;
	    skipped: boolean;
	    reason?: string;

	    static createFrom(source: any = {}) {
	        return new ApplyResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.srcPath = source["srcPath"];
	        this.dstPath = source["dstPath"];
	        this.category = source["category"];
	        this.skipped = source["skipped"];
	        this.reason = source["reason"];
	    }
	}
	export class ApplyCategoriesResult {
	    targetDir: string;
	    moved: number;
	    skipped: number;
	    dryRun: boolean;
	    items: ApplyResult[];
	    elapsed: string;

	    static createFrom(source: any = {}) {
	        return new ApplyCategoriesResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.targetDir = source["targetDir"];
	        this.moved = source["moved"];
	        this.skipped = source["skipped"];
	        this.dryRun = source["dryRun"];
	        this.items = this.convertValues(source["items"], ApplyResult);
	        this.elapsed = source["elapsed"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class AutoFixOptions {
	    dryRun: boolean;
	    backup: boolean;
	    fixSeverity: boolean;
	    severityValue: string;
	    fixInfoFields: boolean;
	    fixMatcherWord: boolean;
	    fixRequestsHTTP: boolean;
	    fixId: boolean;
	    dedupId: boolean;

	    static createFrom(source: any = {}) {
	        return new AutoFixOptions(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dryRun = source["dryRun"];
	        this.backup = source["backup"];
	        this.fixSeverity = source["fixSeverity"];
	        this.severityValue = source["severityValue"];
	        this.fixInfoFields = source["fixInfoFields"];
	        this.fixMatcherWord = source["fixMatcherWord"];
	        this.fixRequestsHTTP = source["fixRequestsHTTP"];
	        this.fixId = source["fixId"];
	        this.dedupId = source["dedupId"];
	    }
	}
	export class DedupRename {
	    path: string;
	    oldId: string;
	    newId: string;

	    static createFrom(source: any = {}) {
	        return new DedupRename(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.oldId = source["oldId"];
	        this.newId = source["newId"];
	    }
	}
	export class FileFixChange {
	    path: string;
	    appliedFixes: string[];
	    originalSize: number;
	    newSize: number;
	    backupPath?: string;
	    skipped: boolean;
	    skipReason?: string;

	    static createFrom(source: any = {}) {
	        return new FileFixChange(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.appliedFixes = source["appliedFixes"];
	        this.originalSize = source["originalSize"];
	        this.newSize = source["newSize"];
	        this.backupPath = source["backupPath"];
	        this.skipped = source["skipped"];
	        this.skipReason = source["skipReason"];
	    }
	}
	export class AutoFixResult {
	    folder: string;
	    total: number;
	    fixed: number;
	    unchanged: number;
	    failed: number;
	    dryRun: boolean;
	    changes: FileFixChange[];
	    dedupRenames: DedupRename[];
	    elapsed: string;

	    static createFrom(source: any = {}) {
	        return new AutoFixResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.folder = source["folder"];
	        this.total = source["total"];
	        this.fixed = source["fixed"];
	        this.unchanged = source["unchanged"];
	        this.failed = source["failed"];
	        this.dryRun = source["dryRun"];
	        this.changes = this.convertValues(source["changes"], FileFixChange);
	        this.dedupRenames = this.convertValues(source["dedupRenames"], DedupRename);
	        this.elapsed = source["elapsed"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class CategoryFile {
	    path: string;
	    relPath: string;
	    name: string;
	    id: string;
	    token: string;
	    size: number;

	    static createFrom(source: any = {}) {
	        return new CategoryFile(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.relPath = source["relPath"];
	        this.name = source["name"];
	        this.id = source["id"];
	        this.token = source["token"];
	        this.size = source["size"];
	    }
	}
	export class ProposedCategory {
	    name: string;
	    tokens: string[];
	    files: CategoryFile[];

	    static createFrom(source: any = {}) {
	        return new ProposedCategory(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.tokens = source["tokens"];
	        this.files = this.convertValues(source["files"], CategoryFile);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CategoryScanResult {
	    folder: string;
	    total: number;
	    categories: ProposedCategory[];
	    uncategorized: CategoryFile[];
	    elapsed: string;

	    static createFrom(source: any = {}) {
	        return new CategoryScanResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.folder = source["folder"];
	        this.total = source["total"];
	        this.categories = this.convertValues(source["categories"], ProposedCategory);
	        this.uncategorized = this.convertValues(source["uncategorized"], CategoryFile);
	        this.elapsed = source["elapsed"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CollectFile {
	    path: string;
	    relPath: string;
	    name: string;
	    id: string;
	    bucket: string;
	    bucketKind: string;
	    size: number;

	    static createFrom(source: any = {}) {
	        return new CollectFile(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.relPath = source["relPath"];
	        this.name = source["name"];
	        this.id = source["id"];
	        this.bucket = source["bucket"];
	        this.bucketKind = source["bucketKind"];
	        this.size = source["size"];
	    }
	}
	export class CollectGroup {
	    name: string;
	    kind: string;
	    files: CollectFile[];

	    static createFrom(source: any = {}) {
	        return new CollectGroup(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.files = this.convertValues(source["files"], CollectFile);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CollectScanResult {
	    folder: string;
	    total: number;
	    groups: CollectGroup[];
	    uncategorized: CollectFile[];
	    elapsed: string;

	    static createFrom(source: any = {}) {
	        return new CollectScanResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.folder = source["folder"];
	        this.total = source["total"];
	        this.groups = this.convertValues(source["groups"], CollectGroup);
	        this.uncategorized = this.convertValues(source["uncategorized"], CollectFile);
	        this.elapsed = source["elapsed"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ConvertBatchItem {
	    name: string;
	    content: string;
	    sourcePath: string;

	    static createFrom(source: any = {}) {
	        return new ConvertBatchItem(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.content = source["content"];
	        this.sourcePath = source["sourcePath"];
	    }
	}
	export class ConvertResult {
	    yaml: string;
	    suggested: string;
	    id: string;
	    title: string;
	    severity: string;
	    tags: string[];
	    sourcePath: string;
	    sourceName: string;
	    warnings: string[];
	    payloadHash: string;

	    static createFrom(source: any = {}) {
	        return new ConvertResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.yaml = source["yaml"];
	        this.suggested = source["suggested"];
	        this.id = source["id"];
	        this.title = source["title"];
	        this.severity = source["severity"];
	        this.tags = source["tags"];
	        this.sourcePath = source["sourcePath"];
	        this.sourceName = source["sourceName"];
	        this.warnings = source["warnings"];
	        this.payloadHash = source["payloadHash"];
	    }
	}
	export class ConvertBatchResult {
	    results: ConvertResult[];
	    total: number;
	    failed: number;
	    elapsed: string;

	    static createFrom(source: any = {}) {
	        return new ConvertBatchResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.results = this.convertValues(source["results"], ConvertResult);
	        this.total = source["total"];
	        this.failed = source["failed"];
	        this.elapsed = source["elapsed"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class ConvertedBatch {
	    results: ConvertResult[];
	    total: number;
	    failed: number;

	    static createFrom(source: any = {}) {
	        return new ConvertedBatch(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.results = this.convertValues(source["results"], ConvertResult);
	        this.total = source["total"];
	        this.failed = source["failed"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class DupTemplate {
	    path: string;
	    relPath: string;
	    name: string;
	    id: string;
	    nameKey: string;
	    size: number;

	    static createFrom(source: any = {}) {
	        return new DupTemplate(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.relPath = source["relPath"];
	        this.name = source["name"];
	        this.id = source["id"];
	        this.nameKey = source["nameKey"];
	        this.size = source["size"];
	    }
	}
	export class DupGroup {
	    groupKey: string;
	    reason: string;
	    sharedIds: string[];
	    sharedNames: string[];
	    templates: DupTemplate[];

	    static createFrom(source: any = {}) {
	        return new DupGroup(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.groupKey = source["groupKey"];
	        this.reason = source["reason"];
	        this.sharedIds = source["sharedIds"];
	        this.sharedNames = source["sharedNames"];
	        this.templates = this.convertValues(source["templates"], DupTemplate);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DupScanResult {
	    folder: string;
	    total: number;
	    duplicateCount: number;
	    groups: DupGroup[];
	    elapsed: string;

	    static createFrom(source: any = {}) {
	        return new DupScanResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.folder = source["folder"];
	        this.total = source["total"];
	        this.duplicateCount = source["duplicateCount"];
	        this.groups = this.convertValues(source["groups"], DupGroup);
	        this.elapsed = source["elapsed"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}


	export class FingerprintCoverage {
	    product: string;
	    fingerRules: number;
	    pocs: number;

	    static createFrom(source: any = {}) {
	        return new FingerprintCoverage(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.product = source["product"];
	        this.fingerRules = source["fingerRules"];
	        this.pocs = source["pocs"];
	    }
	}
	export class FingerprintWorkflowSuggestion {
	    product: string;
	    poc: string;
	    pocId: string;
	    pocRelPath: string;
	    confidence: number;
	    reason: string;

	    static createFrom(source: any = {}) {
	        return new FingerprintWorkflowSuggestion(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.product = source["product"];
	        this.poc = source["poc"];
	        this.pocId = source["pocId"];
	        this.pocRelPath = source["pocRelPath"];
	        this.confidence = source["confidence"];
	        this.reason = source["reason"];
	    }
	}
	export class FingerprintNameDup {
	    name: string;
	    products: string[];

	    static createFrom(source: any = {}) {
	        return new FingerprintNameDup(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.products = source["products"];
	    }
	}
	export class FingerprintRuleDup {
	    rule: string;
	    products: string[];

	    static createFrom(source: any = {}) {
	        return new FingerprintRuleDup(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rule = source["rule"];
	        this.products = source["products"];
	    }
	}
	export class FingerprintRuleIssue {
	    product: string;
	    rule: string;
	    reason: string;

	    static createFrom(source: any = {}) {
	        return new FingerprintRuleIssue(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.product = source["product"];
	        this.rule = source["rule"];
	        this.reason = source["reason"];
	    }
	}
	export class FingerprintPocComponentGroup {
	    product: string;
	    normalizedProduct: string;
	    fingerRuleCount: number;
	    workflowPocCount: number;
	    pocCount: number;
	    referencedPocCount: number;
	    unreferencedPocCount: number;
	    incompletePocCount: number;
	    pocs: FingerprintPocInfo[];

	    static createFrom(source: any = {}) {
	        return new FingerprintPocComponentGroup(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.product = source["product"];
	        this.normalizedProduct = source["normalizedProduct"];
	        this.fingerRuleCount = source["fingerRuleCount"];
	        this.workflowPocCount = source["workflowPocCount"];
	        this.pocCount = source["pocCount"];
	        this.referencedPocCount = source["referencedPocCount"];
	        this.unreferencedPocCount = source["unreferencedPocCount"];
	        this.incompletePocCount = source["incompletePocCount"];
	        this.pocs = this.convertValues(source["pocs"], FingerprintPocInfo);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FingerprintPocFingerMatch {
	    product: string;
	    poc: string;
	    pocId: string;
	    pocRelPath: string;
	    confidence: number;
	    reason: string;
	    path: string;

	    static createFrom(source: any = {}) {
	        return new FingerprintPocFingerMatch(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.product = source["product"];
	        this.poc = source["poc"];
	        this.pocId = source["pocId"];
	        this.pocRelPath = source["pocRelPath"];
	        this.confidence = source["confidence"];
	        this.reason = source["reason"];
	        this.path = source["path"];
	    }
	}
	export class FingerprintPocInfo {
	    path: string;
	    relPath: string;
	    name: string;
	    id: string;
	    infoName: string;
	    severity: string;
	    tags: string[];
	    referencedByWorkflow: boolean;
	    workflowProducts: string[];
	    matchedProduct: string;
	    matchConfidence: number;
	    matchReason: string;
	    incomplete: boolean;
	    issues: string[];
	    contentHash?: string;

	    static createFrom(source: any = {}) {
	        return new FingerprintPocInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.relPath = source["relPath"];
	        this.name = source["name"];
	        this.id = source["id"];
	        this.infoName = source["infoName"];
	        this.severity = source["severity"];
	        this.tags = source["tags"];
	        this.referencedByWorkflow = source["referencedByWorkflow"];
	        this.workflowProducts = source["workflowProducts"];
	        this.matchedProduct = source["matchedProduct"];
	        this.matchConfidence = source["matchConfidence"];
	        this.matchReason = source["matchReason"];
	        this.incomplete = source["incomplete"];
	        this.issues = source["issues"];
	        this.contentHash = source["contentHash"];
	    }
	}
	export class FingerprintWorkflowPoc {
	    product: string;
	    poc: string;

	    static createFrom(source: any = {}) {
	        return new FingerprintWorkflowPoc(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.product = source["product"];
	        this.poc = source["poc"];
	    }
	}
	export class FingerprintAuditResult {
	    projectRoot: string;
	    fingerPath: string;
	    workflowPath: string;
	    pocDir: string;
	    fingerCount: number;
	    fingerRuleCount: number;
	    workflowCount: number;
	    workflowPocRefCount: number;
	    pocFileCount: number;
	    pocWithIdCount: number;
	    missingPocCount: number;
	    orphanPocCount: number;
	    fingerWithoutWorkflowCount: number;
	    workflowWithoutFingerCount: number;
	    fingerWithoutPocCount: number;
	    pocWithFingerCount: number;
	    pocWithFingerWorkflowCount: number;
	    pocWithFingerNoWorkflowCount: number;
	    pocWithoutFingerCount: number;
	    virtualPocCount: number;
	    incompletePocCount: number;
	    classifiedPocCount: number;
	    unmatchedPocCount: number;
	    componentCount: number;
	    weakRuleCount: number;
	    duplicateRuleGroupCount: number;
	    duplicateProductGroupCount: number;
	    workflowSuggestionCount: number;
	    assetOnlyProductCount: number;
	    missingPocs: FingerprintWorkflowPoc[];
	    orphanPocs: FingerprintPocInfo[];
	    fingerWithoutWorkflow: string[];
	    workflowWithoutFinger: string[];
	    fingerWithoutPoc: string[];
	    pocWithFinger: FingerprintPocFingerMatch[];
	    pocWithFingerWorkflow: FingerprintPocFingerMatch[];
	    pocWithFingerNoWorkflow: FingerprintPocFingerMatch[];
	    pocWithoutFinger: FingerprintPocInfo[];
	    virtualPocs: FingerprintPocInfo[];
	    incompletePocs: FingerprintPocInfo[];
	    allPocs: FingerprintPocInfo[];
	    pocGroups: FingerprintPocComponentGroup[];
	    weakRules: FingerprintRuleIssue[];
	    duplicateRules: FingerprintRuleDup[];
	    duplicateProducts: FingerprintNameDup[];
	    workflowSuggestions: FingerprintWorkflowSuggestion[];
	    assetOnlyProducts: string[];
	    topWorkflowProducts: FingerprintCoverage[];
	    topFingerProducts: FingerprintCoverage[];
	    elapsed: string;

	    static createFrom(source: any = {}) {
	        return new FingerprintAuditResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projectRoot = source["projectRoot"];
	        this.fingerPath = source["fingerPath"];
	        this.workflowPath = source["workflowPath"];
	        this.pocDir = source["pocDir"];
	        this.fingerCount = source["fingerCount"];
	        this.fingerRuleCount = source["fingerRuleCount"];
	        this.workflowCount = source["workflowCount"];
	        this.workflowPocRefCount = source["workflowPocRefCount"];
	        this.pocFileCount = source["pocFileCount"];
	        this.pocWithIdCount = source["pocWithIdCount"];
	        this.missingPocCount = source["missingPocCount"];
	        this.orphanPocCount = source["orphanPocCount"];
	        this.fingerWithoutWorkflowCount = source["fingerWithoutWorkflowCount"];
	        this.workflowWithoutFingerCount = source["workflowWithoutFingerCount"];
	        this.fingerWithoutPocCount = source["fingerWithoutPocCount"];
	        this.pocWithFingerCount = source["pocWithFingerCount"];
	        this.pocWithFingerWorkflowCount = source["pocWithFingerWorkflowCount"];
	        this.pocWithFingerNoWorkflowCount = source["pocWithFingerNoWorkflowCount"];
	        this.pocWithoutFingerCount = source["pocWithoutFingerCount"];
	        this.virtualPocCount = source["virtualPocCount"];
	        this.incompletePocCount = source["incompletePocCount"];
	        this.classifiedPocCount = source["classifiedPocCount"];
	        this.unmatchedPocCount = source["unmatchedPocCount"];
	        this.componentCount = source["componentCount"];
	        this.weakRuleCount = source["weakRuleCount"];
	        this.duplicateRuleGroupCount = source["duplicateRuleGroupCount"];
	        this.duplicateProductGroupCount = source["duplicateProductGroupCount"];
	        this.workflowSuggestionCount = source["workflowSuggestionCount"];
	        this.assetOnlyProductCount = source["assetOnlyProductCount"];
	        this.missingPocs = this.convertValues(source["missingPocs"], FingerprintWorkflowPoc);
	        this.orphanPocs = this.convertValues(source["orphanPocs"], FingerprintPocInfo);
	        this.fingerWithoutWorkflow = source["fingerWithoutWorkflow"];
	        this.workflowWithoutFinger = source["workflowWithoutFinger"];
	        this.fingerWithoutPoc = source["fingerWithoutPoc"];
	        this.pocWithFinger = this.convertValues(source["pocWithFinger"], FingerprintPocFingerMatch);
	        this.pocWithFingerWorkflow = this.convertValues(source["pocWithFingerWorkflow"], FingerprintPocFingerMatch);
	        this.pocWithFingerNoWorkflow = this.convertValues(source["pocWithFingerNoWorkflow"], FingerprintPocFingerMatch);
	        this.pocWithoutFinger = this.convertValues(source["pocWithoutFinger"], FingerprintPocInfo);
	        this.virtualPocs = this.convertValues(source["virtualPocs"], FingerprintPocInfo);
	        this.incompletePocs = this.convertValues(source["incompletePocs"], FingerprintPocInfo);
	        this.allPocs = this.convertValues(source["allPocs"], FingerprintPocInfo);
	        this.pocGroups = this.convertValues(source["pocGroups"], FingerprintPocComponentGroup);
	        this.weakRules = this.convertValues(source["weakRules"], FingerprintRuleIssue);
	        this.duplicateRules = this.convertValues(source["duplicateRules"], FingerprintRuleDup);
	        this.duplicateProducts = this.convertValues(source["duplicateProducts"], FingerprintNameDup);
	        this.workflowSuggestions = this.convertValues(source["workflowSuggestions"], FingerprintWorkflowSuggestion);
	        this.assetOnlyProducts = source["assetOnlyProducts"];
	        this.topWorkflowProducts = this.convertValues(source["topWorkflowProducts"], FingerprintCoverage);
	        this.topFingerProducts = this.convertValues(source["topFingerProducts"], FingerprintCoverage);
	        this.elapsed = source["elapsed"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class FingerprintImportApplyRequest {
	    projectRoot: string;
	    ddddYaml: string;
	    confirm: boolean;
	    confirmation: string;

	    static createFrom(source: any = {}) {
	        return new FingerprintImportApplyRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projectRoot = source["projectRoot"];
	        this.ddddYaml = source["ddddYaml"];
	        this.confirm = source["confirm"];
	        this.confirmation = source["confirmation"];
	    }
	}
	export class FingerprintImportApplyResult {
	    targetFingerPath: string;
	    backupPath: string;
	    productsCreated: number;
	    productsMerged: number;
	    rulesAdded: number;
	    rulesSkipped: number;
	    changedProducts: string[];
	    elapsed: string;

	    static createFrom(source: any = {}) {
	        return new FingerprintImportApplyResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.targetFingerPath = source["targetFingerPath"];
	        this.backupPath = source["backupPath"];
	        this.productsCreated = source["productsCreated"];
	        this.productsMerged = source["productsMerged"];
	        this.rulesAdded = source["rulesAdded"];
	        this.rulesSkipped = source["rulesSkipped"];
	        this.changedProducts = source["changedProducts"];
	        this.elapsed = source["elapsed"];
	    }
	}
	export class FingerprintImportRule {
	    expression: string;
	    field: string;
	    operator: string;
	    value: string;
	    weight: number;
	    quality: string;
	    generic: boolean;
	    reasons: string[];
	    original: string;
	    source: string;

	    static createFrom(source: any = {}) {
	        return new FingerprintImportRule(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.expression = source["expression"];
	        this.field = source["field"];
	        this.operator = source["operator"];
	        this.value = source["value"];
	        this.weight = source["weight"];
	        this.quality = source["quality"];
	        this.generic = source["generic"];
	        this.reasons = source["reasons"];
	        this.original = source["original"];
	        this.source = source["source"];
	    }
	}
	export class FingerprintImportItem {
	    product: string;
	    normalizedProduct: string;
	    sourcePath: string;
	    relPath: string;
	    sourceFormat: string;
	    qualityScore: number;
	    quality: string;
	    rules: FingerprintImportRule[];
	    warnings: string[];

	    static createFrom(source: any = {}) {
	        return new FingerprintImportItem(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.product = source["product"];
	        this.normalizedProduct = source["normalizedProduct"];
	        this.sourcePath = source["sourcePath"];
	        this.relPath = source["relPath"];
	        this.sourceFormat = source["sourceFormat"];
	        this.qualityScore = source["qualityScore"];
	        this.quality = source["quality"];
	        this.rules = this.convertValues(source["rules"], FingerprintImportRule);
	        this.warnings = source["warnings"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FingerprintImportSkip {
	    path: string;
	    relPath: string;
	    reason: string;

	    static createFrom(source: any = {}) {
	        return new FingerprintImportSkip(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.relPath = source["relPath"];
	        this.reason = source["reason"];
	    }
	}
	export class FingerprintMergeSuggestion {
	    normalizedProduct: string;
	    products: string[];
	    existing: string[];
	    imported: string[];

	    static createFrom(source: any = {}) {
	        return new FingerprintMergeSuggestion(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.normalizedProduct = source["normalizedProduct"];
	        this.products = source["products"];
	        this.existing = source["existing"];
	        this.imported = source["imported"];
	    }
	}
	export class FingerprintImportPreviewResult {
	    sourceDir: string;
	    projectRoot: string;
	    targetFingerPath: string;
	    scannedFiles: number;
	    parsedFiles: number;
	    skippedFiles: number;
	    candidateCount: number;
	    productCount: number;
	    ruleCount: number;
	    highConfidenceCount: number;
	    genericRuleCount: number;
	    duplicateRuleCount: number;
	    mergeSuggestionCount: number;
	    items: FingerprintImportItem[];
	    duplicateRules: FingerprintRuleDup[];
	    mergeSuggestions: FingerprintMergeSuggestion[];
	    skipped: FingerprintImportSkip[];
	    ddddYaml: string;
	    patchPreview: string;
	    elapsed: string;

	    static createFrom(source: any = {}) {
	        return new FingerprintImportPreviewResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sourceDir = source["sourceDir"];
	        this.projectRoot = source["projectRoot"];
	        this.targetFingerPath = source["targetFingerPath"];
	        this.scannedFiles = source["scannedFiles"];
	        this.parsedFiles = source["parsedFiles"];
	        this.skippedFiles = source["skippedFiles"];
	        this.candidateCount = source["candidateCount"];
	        this.productCount = source["productCount"];
	        this.ruleCount = source["ruleCount"];
	        this.highConfidenceCount = source["highConfidenceCount"];
	        this.genericRuleCount = source["genericRuleCount"];
	        this.duplicateRuleCount = source["duplicateRuleCount"];
	        this.mergeSuggestionCount = source["mergeSuggestionCount"];
	        this.items = this.convertValues(source["items"], FingerprintImportItem);
	        this.duplicateRules = this.convertValues(source["duplicateRules"], FingerprintRuleDup);
	        this.mergeSuggestions = this.convertValues(source["mergeSuggestions"], FingerprintMergeSuggestion);
	        this.skipped = this.convertValues(source["skipped"], FingerprintImportSkip);
	        this.ddddYaml = source["ddddYaml"];
	        this.patchPreview = source["patchPreview"];
	        this.elapsed = source["elapsed"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}




	export class FingerprintPocDuplicate {
	    key: string;
	    reason: string;
	    keptPath: string;
	    keptRelPath: string;
	    duplicatePath: string;
	    duplicateRelPath: string;

	    static createFrom(source: any = {}) {
	        return new FingerprintPocDuplicate(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.reason = source["reason"];
	        this.keptPath = source["keptPath"];
	        this.keptRelPath = source["keptRelPath"];
	        this.duplicatePath = source["duplicatePath"];
	        this.duplicateRelPath = source["duplicateRelPath"];
	    }
	}
	export class FingerprintPocCatalogResult {
	    projectRoot: string;
	    sourceType: string;
	    sourceDir: string;
	    fingerPath: string;
	    workflowPath: string;
	    pocDir: string;
	    fingerCount: number;
	    workflowCount: number;
	    pocFileCount: number;
	    uniquePocCount: number;
	    duplicatePocCount: number;
	    classifiedPocCount: number;
	    unmatchedPocCount: number;
	    workflowPocCount: number;
	    virtualPocCount: number;
	    incompletePocCount: number;
	    componentCount: number;
	    allPocs: FingerprintPocInfo[];
	    groups: FingerprintPocComponentGroup[];
	    unmatchedPocs: FingerprintPocInfo[];
	    virtualPocs: FingerprintPocInfo[];
	    incompletePocs: FingerprintPocInfo[];
	    duplicatePocs: FingerprintPocDuplicate[];
	    elapsed: string;

	    static createFrom(source: any = {}) {
	        return new FingerprintPocCatalogResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projectRoot = source["projectRoot"];
	        this.sourceType = source["sourceType"];
	        this.sourceDir = source["sourceDir"];
	        this.fingerPath = source["fingerPath"];
	        this.workflowPath = source["workflowPath"];
	        this.pocDir = source["pocDir"];
	        this.fingerCount = source["fingerCount"];
	        this.workflowCount = source["workflowCount"];
	        this.pocFileCount = source["pocFileCount"];
	        this.uniquePocCount = source["uniquePocCount"];
	        this.duplicatePocCount = source["duplicatePocCount"];
	        this.classifiedPocCount = source["classifiedPocCount"];
	        this.unmatchedPocCount = source["unmatchedPocCount"];
	        this.workflowPocCount = source["workflowPocCount"];
	        this.virtualPocCount = source["virtualPocCount"];
	        this.incompletePocCount = source["incompletePocCount"];
	        this.componentCount = source["componentCount"];
	        this.allPocs = this.convertValues(source["allPocs"], FingerprintPocInfo);
	        this.groups = this.convertValues(source["groups"], FingerprintPocComponentGroup);
	        this.unmatchedPocs = this.convertValues(source["unmatchedPocs"], FingerprintPocInfo);
	        this.virtualPocs = this.convertValues(source["virtualPocs"], FingerprintPocInfo);
	        this.incompletePocs = this.convertValues(source["incompletePocs"], FingerprintPocInfo);
	        this.duplicatePocs = this.convertValues(source["duplicatePocs"], FingerprintPocDuplicate);
	        this.elapsed = source["elapsed"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}








	export class YamlFile {
	    name: string;
	    path: string;
	    content: string;
	    relPath: string;

	    static createFrom(source: any = {}) {
	        return new YamlFile(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.content = source["content"];
	        this.relPath = source["relPath"];
	    }
	}
	export class LoadDirectoryResult {
	    files: YamlFile[];
	    truncated: boolean;
	    limit: number;

	    static createFrom(source: any = {}) {
	        return new LoadDirectoryResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.files = this.convertValues(source["files"], YamlFile);
	        this.truncated = source["truncated"];
	        this.limit = source["limit"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MoveDuplicatesRequest {
	    paths: string[];
	    targetDir: string;
	    dryRun: boolean;
	    onConflict: string;

	    static createFrom(source: any = {}) {
	        return new MoveDuplicatesRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.paths = source["paths"];
	        this.targetDir = source["targetDir"];
	        this.dryRun = source["dryRun"];
	        this.onConflict = source["onConflict"];
	    }
	}
	export class MoveResult {
	    srcPath: string;
	    dstPath: string;
	    skipped: boolean;
	    reason?: string;

	    static createFrom(source: any = {}) {
	        return new MoveResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.srcPath = source["srcPath"];
	        this.dstPath = source["dstPath"];
	        this.skipped = source["skipped"];
	        this.reason = source["reason"];
	    }
	}
	export class MoveDuplicatesResult {
	    targetDir: string;
	    moved: number;
	    skipped: number;
	    dryRun: boolean;
	    items: MoveResult[];
	    elapsed: string;

	    static createFrom(source: any = {}) {
	        return new MoveDuplicatesResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.targetDir = source["targetDir"];
	        this.moved = source["moved"];
	        this.skipped = source["skipped"];
	        this.dryRun = source["dryRun"];
	        this.items = this.convertValues(source["items"], MoveResult);
	        this.elapsed = source["elapsed"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class ValidateIssue {
	    path: string;
	    cause: string;
	    line: string;

	    static createFrom(source: any = {}) {
	        return new ValidateIssue(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.cause = source["cause"];
	        this.line = source["line"];
	    }
	}
	export class NucleiValidateResult {
	    folder: string;
	    ok: boolean;
	    errors: ValidateIssue[];
	    warnings: ValidateIssue[];
	    raw: string;
	    rawTruncated: boolean;
	    elapsed: string;
	    binary: string;
	    version: string;

	    static createFrom(source: any = {}) {
	        return new NucleiValidateResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.folder = source["folder"];
	        this.ok = source["ok"];
	        this.errors = this.convertValues(source["errors"], ValidateIssue);
	        this.warnings = this.convertValues(source["warnings"], ValidateIssue);
	        this.raw = source["raw"];
	        this.rawTruncated = source["rawTruncated"];
	        this.elapsed = source["elapsed"];
	        this.binary = source["binary"];
	        this.version = source["version"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class SkippedItem {
	    name: string;
	    reason: string;
	    dupOf: string;

	    static createFrom(source: any = {}) {
	        return new SkippedItem(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.reason = source["reason"];
	        this.dupOf = source["dupOf"];
	    }
	}
	export class SaveYamlBatchResult {
	    written: number;
	    renamed: number;
	    skippedDupContent: number;
	    skippedDupPayload: number;
	    writtenNames: string[];
	    skippedItems: SkippedItem[];

	    static createFrom(source: any = {}) {
	        return new SaveYamlBatchResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.written = source["written"];
	        this.renamed = source["renamed"];
	        this.skippedDupContent = source["skippedDupContent"];
	        this.skippedDupPayload = source["skippedDupPayload"];
	        this.writtenNames = source["writtenNames"];
	        this.skippedItems = this.convertValues(source["skippedItems"], SkippedItem);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}



	export class YamlOutFile {
	    name: string;
	    content: string;

	    static createFrom(source: any = {}) {
	        return new YamlOutFile(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.content = source["content"];
	    }
	}

}

