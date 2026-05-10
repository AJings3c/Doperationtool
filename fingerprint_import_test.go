package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPreviewFingerprintImportGenericFormats(t *testing.T) {
	root := t.TempDir()
	cfg := filepath.Join(root, "common", "config")
	if err := os.MkdirAll(cfg, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(cfg, "finger.yaml"), "ExistingApp:\n  - 'title=\"Existing Portal\"'\n")

	src := t.TempDir()
	writeTestFile(t, filepath.Join(src, "yaml-map.yaml"), `YamlApp:
  - title="Yaml Portal"
  - icon_hash="123456789"
YamlApp Community:
  body:
    - /static/yamlapp.js
`)
	writeTestFile(t, filepath.Join(src, "json-list.json"), `[
  {"name":"JsonApp", "headers":{"Server":"JsonApp"}, "favicon_hash":"987654321"},
  {"product":"ExistingApp", "rules":["title=\"Existing Portal\"", "body=\"Existing Unique Marker\""]}
]`)
	writeTestFile(t, filepath.Join(src, "plain.txt"), "body=\"Plain Unique Marker\"\nlogin\n")

	res, err := NewApp().PreviewFingerprintImport(root, src)
	if err != nil {
		t.Fatalf("PreviewFingerprintImport returned error: %v", err)
	}
	if res.ScannedFiles != 3 || res.ParsedFiles != 3 || res.SkippedFiles != 0 {
		t.Fatalf("scan stats = %d/%d/%d", res.ScannedFiles, res.ParsedFiles, res.SkippedFiles)
	}
	if res.ProductCount < 4 {
		t.Fatalf("ProductCount = %d, want >= 4; items=%#v", res.ProductCount, res.Items)
	}
	if res.RuleCount == 0 || res.HighConfidenceCount == 0 || res.GenericRuleCount == 0 {
		t.Fatalf("rule stats = total:%d high:%d generic:%d", res.RuleCount, res.HighConfidenceCount, res.GenericRuleCount)
	}
	if !strings.Contains(res.DDDDYaml, "YamlApp:") || !strings.Contains(res.DDDDYaml, "JsonApp:") || !strings.Contains(res.DDDDYaml, "plain:") {
		t.Fatalf("DDDDYaml missing expected products:\n%s", res.DDDDYaml)
	}
	if !strings.Contains(res.DDDDYaml, `title="Yaml Portal"`) || !strings.Contains(res.DDDDYaml, `icon_hash="123456789"`) || !strings.Contains(res.DDDDYaml, `body="Plain Unique Marker"`) {
		t.Fatalf("DDDDYaml missing expected expressions:\n%s", res.DDDDYaml)
	}
	if res.MergeSuggestionCount == 0 {
		t.Fatalf("expected merge suggestion for existing product")
	}
	foundExistingWarning := false
	for _, item := range res.Items {
		if item.Product != "ExistingApp" {
			continue
		}
		for _, w := range item.Warnings {
			if strings.Contains(w, "已存在相同规则") {
				foundExistingWarning = true
			}
		}
	}
	if !foundExistingWarning {
		t.Fatalf("expected existing rule warning, items=%#v", res.Items)
	}
}

func TestPreviewFingerprintImportSkipsNonText(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "bin.dat"), []byte{0, 1, 2, 3}, 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := NewApp().PreviewFingerprintImport("", src)
	if err != nil {
		t.Fatalf("PreviewFingerprintImport returned error: %v", err)
	}
	if res.SkippedFiles != 1 || len(res.Skipped) != 1 || !strings.Contains(res.Skipped[0].Reason, "非文本") {
		t.Fatalf("skip result = %#v", res.Skipped)
	}
}

func TestPreviewFingerprintImportAfrogFingerprints(t *testing.T) {
	src := t.TempDir()
	writeTestFile(t, filepath.Join(src, "acemanager-login.yaml"), `id: acemanager-login
info:
  name: ACEmanager Detection
rules:
  r0:
    request:
      method: GET
      path: /
    expression: |
      response.status == 200 &&
      response.body.ibcontains(b'<title>::: ACEmanager :::</title>')
expression: r0()
`)
	writeTestFile(t, filepath.Join(src, "panel-detect.yaml"), `id: panel-detect
info:
  name: Panel Detect
rules:
  r0:
    expressions:
      - '"apache-activemq" != "" && response.status == 200 && response.body.bcontains(b"<title>Apache ActiveMQ</title>")'
      - '"terramaster-panel" != "" && response.status == 200 && (response.body.bcontains(b"<title>TOS Loading</title>") || response.headers["server"] == "TOS")'
      - '"upupw-tz-panel" != "" && response.status == 200 && "<title>UPUPW(.*)</title>".bmatches(response.body)'
expression: r0()
`)

	res, err := NewApp().PreviewFingerprintImport("", src)
	if err != nil {
		t.Fatalf("PreviewFingerprintImport returned error: %v", err)
	}
	if res.ScannedFiles != 2 || res.ParsedFiles != 2 {
		t.Fatalf("scan stats = %d/%d/%d", res.ScannedFiles, res.ParsedFiles, res.SkippedFiles)
	}
	for _, want := range []string{`"acemanager-login":`, `"apache-activemq":`, `"terramaster-panel":`, `"upupw-tz-panel":`} {
		if !strings.Contains(res.DDDDYaml, want) {
			t.Fatalf("DDDDYaml missing %s:\n%s", want, res.DDDDYaml)
		}
	}
	for _, want := range []string{`title="::: ACEmanager :::"`, `title="Apache ActiveMQ"`, `header="server: TOS"`, `title~="UPUPW(.*)"`} {
		if !strings.Contains(res.DDDDYaml, want) {
			t.Fatalf("DDDDYaml missing %s:\n%s", want, res.DDDDYaml)
		}
	}
}
func TestApplyFingerprintImportRequiresConfirmationAndWritesBackup(t *testing.T) {
	root := t.TempDir()
	cfg := filepath.Join(root, "common", "config")
	if err := os.MkdirAll(cfg, 0o755); err != nil {
		t.Fatal(err)
	}
	fingerPath := filepath.Join(cfg, "finger.yaml")
	writeTestFile(t, fingerPath, "ExistingApp:\n  - 'title=\"Existing Portal\"'\n")

	_, err := NewApp().ApplyFingerprintImport(FingerprintImportApplyRequest{
		ProjectRoot: root,
		DDDDYaml:    "ExistingApp:\n  - 'body=\"New Marker\"'\n",
	})
	if err == nil {
		t.Fatal("expected confirmation error")
	}

	res, err := NewApp().ApplyFingerprintImport(FingerprintImportApplyRequest{
		ProjectRoot:  root,
		DDDDYaml:     "ExistingApp:\n  - 'title=\"Existing Portal\"'\n  - 'body=\"New Marker\"'\nNewApp:\n  - 'icon_hash=\"123456\"'\n",
		Confirm:      true,
		Confirmation: "APPLY_FINGERPRINT_IMPORT",
	})
	if err != nil {
		t.Fatalf("ApplyFingerprintImport returned error: %v", err)
	}
	if res.ProductsCreated != 1 || res.ProductsMerged != 1 || res.RulesAdded != 2 || res.RulesSkipped != 1 {
		t.Fatalf("apply stats = %#v", res)
	}
	if res.BackupPath == "" {
		t.Fatal("expected backup path")
	}
	if _, err := os.Stat(res.BackupPath); err != nil {
		t.Fatalf("backup does not exist: %v", err)
	}
	raw, err := os.ReadFile(fingerPath)
	if err != nil {
		t.Fatal(err)
	}
	got := string(raw)
	if !strings.Contains(got, "ExistingApp:") || !strings.Contains(got, `body="New Marker"`) || !strings.Contains(got, "NewApp:") {
		t.Fatalf("finger.yaml not merged as expected:\n%s", got)
	}
}
