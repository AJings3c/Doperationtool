package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExternalCapabilityUsesDDDDCommonConfigPocs(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, "common", "config")
	pocDir := filepath.Join(cfgDir, "pocs")
	if err := os.MkdirAll(pocDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(cfgDir, "finger.yaml"), "Alpha:\n  - 'title=\"Alpha\"'\n")
	writeTestFile(t, filepath.Join(cfgDir, "workflow.yaml"), "Alpha:\n  type:\n    - http\n  pocs:\n    - alpha-old\n")
	writeTestFile(t, filepath.Join(pocDir, "alpha-old.yaml"), "id: alpha-old\ninfo:\n  name: Alpha Old\n  severity: low\nhttp:\n  - matchers:\n      - type: word\n        words: [Alpha]\n")

	fingerReviewDir := t.TempDir()
	writeTestFile(t, filepath.Join(fingerReviewDir, "finger.yaml"), "Alpha:\n  - 'body=\"Alpha New\"'\nBeta:\n  - 'title=\"Beta\"'\n")

	pocReviewDir := t.TempDir()
	reviewPocPath := filepath.Join(pocReviewDir, "pocs", "Beta", "source-file.yaml")
	if err := os.MkdirAll(filepath.Dir(reviewPocPath), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, reviewPocPath, "id: new-poc\ninfo:\n  name: Beta New\n  severity: high\nhttp:\n  - matchers:\n      - type: word\n        words: [Beta]\n")
	if err := writeJSON(filepath.Join(pocReviewDir, "review.json"), storedPocReview{
		Kind: "poc",
		Items: []FingerprintPocInfo{{
			Path:            reviewPocPath,
			RelPath:         filepath.ToSlash(filepath.Join("pocs", "Beta", "source-file.yaml")),
			Name:            "source-file.yaml",
			ID:              "new-poc",
			MatchedProduct:  "Beta",
			MatchConfidence: 90,
		}, {
			Path:            reviewPocPath,
			RelPath:         filepath.ToSlash(filepath.Join("pocs", "Beta", "duplicate-source-file.yaml")),
			Name:            "duplicate-source-file.yaml",
			ID:              "duplicate-new-poc",
			MatchedProduct:  "Beta",
			MatchConfidence: 90,
			Duplicate:       true,
		}},
	}); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	scan, err := app.ScanExternalCapability(root, pocReviewDir, fingerReviewDir)
	if err != nil {
		t.Fatalf("ScanExternalCapability returned error: %v", err)
	}
	if scan.NewFingerProducts != 2 || scan.NewFingerRules != 2 || scan.NewPocCount != 1 {
		t.Fatalf("scan stats = %#v", scan)
	}

	writeTestFile(t, filepath.Join(pocDir, "new-poc.yaml"), "id: collision-existing\ninfo:\n  name: Existing Same Filename\n  severity: low\n")

	apply, err := app.ApplyExternalCapability(ApplyExternalCapabilityRequest{
		ProjectRoot:   root,
		NewFingerYaml: scan.NewFingerYaml,
		NewPocs:       scan.NewPocs,
		Confirm:       true,
		Confirmation:  "APPLY_EXTERNAL_CAPABILITY",
	})
	if err != nil {
		t.Fatalf("ApplyExternalCapability returned error: %v", err)
	}
	if apply.PocTargetDir != pocDir || apply.PocsCopied != 1 || apply.WorkflowProducts != 1 {
		t.Fatalf("apply result = %#v, want target %s", apply, pocDir)
	}
	if _, err := os.Stat(filepath.Join(pocDir, "new-poc-2.yaml")); err != nil {
		t.Fatalf("expected copied poc in common/config/pocs without overwriting existing file: %v", err)
	}
	existingRaw, err := os.ReadFile(filepath.Join(pocDir, "new-poc.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(existingRaw); !strings.Contains(got, "collision-existing") {
		t.Fatalf("existing same-name poc was overwritten:\n%s", got)
	}
	if _, err := os.Stat(filepath.Join(root, "config", "pocs")); !os.IsNotExist(err) {
		t.Fatalf("unexpected legacy config/pocs directory err=%v", err)
	}
	workflowRaw, err := os.ReadFile(filepath.Join(cfgDir, "workflow.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(workflowRaw); !strings.Contains(got, "Beta:") || !strings.Contains(got, "new-poc-2") {
		t.Fatalf("workflow.yaml did not include new product/poc:\n%s", got)
	}
	fingerRaw, err := os.ReadFile(filepath.Join(cfgDir, "finger.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(fingerRaw); !strings.Contains(got, `body="Alpha New"`) || !strings.Contains(got, "Beta:") {
		t.Fatalf("finger.yaml did not include merged rules:\n%s", got)
	}
}
