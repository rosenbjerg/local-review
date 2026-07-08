package git

import "testing"

func TestParseHunkHeader(t *testing.T) {
	cases := []struct {
		name             string
		header           string
		wantOld, wantNew int
	}{
		{"plain", "@@ -12,7 +12,9 @@ func normal() {", 12, 12},
		{"python return arrow", "@@ -40,6 +42,8 @@ def foo(x: int) -> str:", 40, 42},
		{"rust return arrow", "@@ -100,4 +100,4 @@ fn f() -> Result<T, E> {", 100, 100},
		{"plus in heading", "@@ -5,2 +5,3 @@ total += 1", 5, 5},
		{"negative literal in heading", "@@ -10,3 +10,4 @@ if x == -1 {", 10, 10},
		{"single-line ranges", "@@ -1 +1 @@", 1, 1},
		{"no heading", "@@ -20,5 +30,6 @@", 20, 30},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotOld, gotNew := parseHunkHeader(c.header)
			if gotOld != c.wantOld || gotNew != c.wantNew {
				t.Errorf("parseHunkHeader(%q) = (old=%d, new=%d), want (old=%d, new=%d)",
					c.header, gotOld, gotNew, c.wantOld, c.wantNew)
			}
		})
	}
}
