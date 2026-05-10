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
Gamma:
  type:
    - root
  pocs:
    - gamma-panel
`
	writeTestFile(t, filepath.Join(cfgDir, "finger.yaml"), finger)
	writeTestFile(t, filepath.Join(cfgDir, "workflow.yaml"), workflow)
	writeTestFile(t, filepath.Join(pocDir, "alpha-rce.yaml"), "id: alpha-rce\ninfo:\n  name: alpha\n")
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
	if res.WorkflowCount != 2 || res.WorkflowPocRefCount != 3 {
		t.Fatalf("workflow stats = %d/%d, want 2/3", res.WorkflowCount, res.WorkflowPocRefCount)
	}
	if res.PocFileCount != 4 || res.PocWithIDCount != 4 {
		t.Fatalf("poc stats = %d/%d, want 3/3", res.PocFileCount, res.PocWithIDCount)
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
	if res.PocWithoutFingerCount != 1 || len(res.PocWithoutFinger) != 1 || res.PocWithoutFinger[0].ID != "orphan-id" {
		t.Fatalf("PocWithoutFinger = %#v, count=%d", res.PocWithoutFinger, res.PocWithoutFingerCount)
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

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
