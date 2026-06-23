package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAuditFingerprintKnowledge(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, "common", "config")
	pocDir := filepath.Join(cfgDir, "pocs")
	if err := os.MkdirAll(pocDir, 0o755); err != nil {
		t.Fatal(err)
	}

	finger := `Alpha:
  - 'body="login"'
  - 'title="Alpha Portal"'
Alpha-optimize:
  - 'body="Alpha Portal"'
Beta:
  - 'body="be"'
SharedOne:
  - 'body="SAME-SIGNATURE"'
SharedTwo:
  - 'body="SAME-SIGNATURE"'
`
	workflow := `Alpha:
  type:
    - root
  pocs:
    - alpha-rce
    - missing-poc
Delta:
  type:
    - root
  pocs:
    - delta-check
Gamma:
  type:
    - root
  pocs:
    - gamma-panel
`
	dir := `Alpha:
  - /alpha/login
Delta:
  - /delta/check
`
	writeTestFile(t, filepath.Join(cfgDir, "finger.yaml"), finger)
	writeTestFile(t, filepath.Join(cfgDir, "dir.yaml"), dir)
	writeTestFile(t, filepath.Join(cfgDir, "workflow.yaml"), workflow)
	writeTestFile(t, filepath.Join(pocDir, "alpha-rce.yaml"), "id: alpha-rce\ninfo:\n  name: alpha\n")
	writeTestFile(t, filepath.Join(pocDir, "delta-check.yaml"), "id: delta-check\ninfo:\n  name: delta\n")
	writeTestFile(t, filepath.Join(pocDir, "beta.yaml"), "id: beta\ninfo:\n  name: beta\n")
	writeTestFile(t, filepath.Join(pocDir, "gamma-panel.yml"), "id: gamma-panel\ninfo:\n  name: gamma\n")
	writeTestFile(t, filepath.Join(pocDir, "orphan.yaml"), "id: orphan-id\ninfo:\n  name: orphan\n")

	res, err := NewApp().AuditFingerprintKnowledge(root)
	if err != nil {
		t.Fatalf("AuditFingerprintKnowledge returned error: %v", err)
	}
	if res.FingerCount != 5 {
		t.Fatalf("FingerCount = %d, want 5", res.FingerCount)
	}
	if res.DirCount != 2 || res.DirPathCount != 2 || res.DirOnlyProductCount != 1 {
		t.Fatalf("dir stats = count %d paths %d dirOnly %d, want 2/2/1", res.DirCount, res.DirPathCount, res.DirOnlyProductCount)
	}
	if res.WorkflowCount != 3 || res.WorkflowPocRefCount != 4 {
		t.Fatalf("workflow stats = %d/%d, want 3/4", res.WorkflowCount, res.WorkflowPocRefCount)
	}
	if res.PocFileCount != 5 || res.PocWithIDCount != 5 {
		t.Fatalf("poc stats = %d/%d, want 5/5", res.PocFileCount, res.PocWithIDCount)
	}
	if res.MissingPocCount != 1 || len(res.MissingPocs) != 1 || res.MissingPocs[0].Poc != "missing-poc" {
		t.Fatalf("missing pocs = %#v, count=%d", res.MissingPocs, res.MissingPocCount)
	}
	if res.OrphanPocCount != 2 || len(res.OrphanPocs) != 2 {
		t.Fatalf("orphan pocs = %#v, count=%d", res.OrphanPocs, res.OrphanPocCount)
	}
	if res.FingerWithoutWorkflowCount != 3 {
		t.Fatalf("FingerWithoutWorkflowCount = %d, want 3", res.FingerWithoutWorkflowCount)
	}
	if res.WorkflowWithoutFingerCount != 1 || len(res.WorkflowWithoutFinger) != 1 || res.WorkflowWithoutFinger[0] != "Gamma" {
		t.Fatalf("WorkflowWithoutFinger = %#v, count=%d", res.WorkflowWithoutFinger, res.WorkflowWithoutFingerCount)
	}
	if res.FingerWithoutPocCount != 3 || len(res.FingerWithoutPoc) != 3 {
		t.Fatalf("FingerWithoutPoc = %#v, count=%d", res.FingerWithoutPoc, res.FingerWithoutPocCount)
	}
	if res.PocWithFingerNoWorkflowCount != 1 || len(res.PocWithFingerNoWorkflow) != 1 || res.PocWithFingerNoWorkflow[0].Product != "Beta" {
		t.Fatalf("PocWithFingerNoWorkflow = %#v, count=%d", res.PocWithFingerNoWorkflow, res.PocWithFingerNoWorkflowCount)
	}
	if res.PocWithFingerCount != 3 || res.PocWithFingerWorkflowCount != 2 {
		t.Fatalf("poc with finger counts = %d/%d, pocs=%#v", res.PocWithFingerCount, res.PocWithFingerWorkflowCount, res.PocWithFinger)
	}
	if res.VirtualPocCount != 2 || len(res.VirtualPocs) != 2 {
		t.Fatalf("VirtualPocs = %#v, count=%d", res.VirtualPocs, res.VirtualPocCount)
	}
	if res.PocWithoutFingerCount != 2 || len(res.PocWithoutFinger) != 2 {
		t.Fatalf("PocWithoutFinger = %#v, count=%d", res.PocWithoutFinger, res.PocWithoutFingerCount)
	}
	if res.IncompletePocCount != 5 || len(res.IncompletePocs) != 5 {
		t.Fatalf("IncompletePocs = %#v, count=%d", res.IncompletePocs, res.IncompletePocCount)
	}
	foundDirOnlyWorkflow := false
	for _, p := range res.PocWithFingerWorkflow {
		if p.Product == "Delta" && p.Source == "dir" {
			foundDirOnlyWorkflow = true
			break
		}
	}
	if !foundDirOnlyWorkflow {
		t.Fatalf("expected dir-only Delta POC to be recognized and workflow-linked: %#v", res.PocWithFingerWorkflow)
	}
	if res.WeakRuleCount != 2 || len(res.WeakRules) != 2 {
		t.Fatalf("WeakRuleCount = %d, weakRules=%#v, want 2", res.WeakRuleCount, res.WeakRules)
	}
	if res.DuplicateRuleGroupCount != 1 || len(res.DuplicateRules) != 1 {
		t.Fatalf("DuplicateRuleGroupCount = %d, duplicateRules=%#v, want 1", res.DuplicateRuleGroupCount, res.DuplicateRules)
	}
	if res.DuplicateProductGroupCount != 1 || len(res.DuplicateProducts) != 1 {
		t.Fatalf("DuplicateProductGroupCount = %d, duplicateProducts=%#v, want 1", res.DuplicateProductGroupCount, res.DuplicateProducts)
	}
	if res.WorkflowSuggestionCount != 1 || len(res.WorkflowSuggestions) != 1 || res.WorkflowSuggestions[0].Product != "Beta" {
		t.Fatalf("WorkflowSuggestions = %#v, count=%d", res.WorkflowSuggestions, res.WorkflowSuggestionCount)
	}
	if res.AssetOnlyProductCount != 2 || len(res.AssetOnlyProducts) != 2 {
		t.Fatalf("AssetOnlyProducts = %#v, count=%d", res.AssetOnlyProducts, res.AssetOnlyProductCount)
	}
}

func TestAuditFingerprintKnowledgeRequiresDDDDLayout(t *testing.T) {
	_, err := NewApp().AuditFingerprintKnowledge(t.TempDir())
	if err == nil {
		t.Fatal("expected missing config paths error")
	}
}

func TestClassifyDDDDBuiltinPocs(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, "common", "config")
	pocDir := filepath.Join(cfgDir, "pocs")
	if err := os.MkdirAll(pocDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(cfgDir, "finger.yaml"), "Alpha:\n  - 'title=\"Alpha\"'\n")
	writeTestFile(t, filepath.Join(cfgDir, "dir.yaml"), "Beta:\n  - /beta/login\n")
	writeTestFile(t, filepath.Join(cfgDir, "workflow.yaml"), "Alpha:\n  pocs:\n    - alpha-rce\n")
	writeTestFile(t, filepath.Join(pocDir, "alpha-rce.yaml"), "id: alpha-rce\ninfo:\n  name: Alpha RCE\n  severity: high\nhttp:\n  - matchers:\n      - type: word\n        words: [Alpha]\n")
	writeTestFile(t, filepath.Join(pocDir, "beta.yaml"), "id: beta\ninfo:\n  name: Beta Panel\n")
	writeTestFile(t, filepath.Join(pocDir, "unknown.yaml"), "id: unknown\ninfo:\n  name: Unknown\n  severity: low\nhttp:\n  - matchers:\n      - type: word\n        words: [Unknown]\n")

	res, err := NewApp().ClassifyDDDDBuiltinPocs(root)
	if err != nil {
		t.Fatalf("ClassifyDDDDBuiltinPocs returned error: %v", err)
	}
	if res.PocFileCount != 3 || len(res.AllPocs) != 3 {
		t.Fatalf("all pocs = %d/%d", res.PocFileCount, len(res.AllPocs))
	}
	if res.DirCount != 1 || res.DirPathCount != 1 || res.RecognitionProductCount != 2 {
		t.Fatalf("dir/recognition stats = %d/%d/%d", res.DirCount, res.DirPathCount, res.RecognitionProductCount)
	}
	if res.ClassifiedPocCount != 2 || res.UnmatchedPocCount != 1 || res.ComponentCount != 2 {
		t.Fatalf("classified/unmatched/groups = %d/%d/%d groups=%#v", res.ClassifiedPocCount, res.UnmatchedPocCount, res.ComponentCount, res.Groups)
	}
	if res.VirtualPocCount != 2 || len(res.VirtualPocs) != 2 {
		t.Fatalf("virtual pocs = %#v count=%d", res.VirtualPocs, res.VirtualPocCount)
	}
	if res.IncompletePocCount != 1 || len(res.IncompletePocs) != 1 || res.IncompletePocs[0].ID != "beta" {
		t.Fatalf("incomplete pocs = %#v count=%d", res.IncompletePocs, res.IncompletePocCount)
	}
}

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
