// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsearch

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	SnippetContextBefore = 60
	SnippetContextAfter  = 120
	MaxCwdProbeLines     = 200
	ReadBufferSize       = 256 * 1024
)

type claudeRecord struct {
	Type      string          `json:"type"`
	Cwd       string          `json:"cwd"`
	Timestamp string          `json:"timestamp"`
	SessionId string          `json:"sessionId"`
	IsMeta    bool            `json:"isMeta"`
	Message   json.RawMessage `json:"message"`
}

type claudeMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type claudeContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type matcher struct {
	// needles are lowercased; the JSON-escaped form is included so a query containing a backslash
	// or quote (e.g. a Windows path) still hits the raw JSONL line before decoding.
	needles [][]byte
	lower   string
}

func makeMatcher(query string) *matcher {
	lower := strings.ToLower(query)
	m := &matcher{lower: lower, needles: [][]byte{[]byte(lower)}}
	escaped, err := json.Marshal(lower)
	if err == nil && len(escaped) >= 2 {
		esc := escaped[1 : len(escaped)-1]
		if !bytes.Equal(esc, m.needles[0]) {
			m.needles = append(m.needles, esc)
		}
	}
	return m
}

func (m *matcher) rawMatch(lowerLine []byte) bool {
	for _, n := range m.needles {
		if bytes.Contains(lowerLine, n) {
			return true
		}
	}
	return false
}

func claudeRoot() string {
	if dir := os.Getenv("CLAUDE_CONFIG_DIR"); dir != "" {
		return dir
	}
	return filepath.Join(homeDir(), ".claude")
}

func collectClaudeFiles(sessions bool, memory bool) []searchFile {
	root := claudeRoot()
	var rtn []searchFile
	if memory {
		globalMem, _ := filepath.Glob(filepath.Join(root, "memory", "*.md"))
		for _, p := range globalMem {
			rtn = append(rtn, searchFile{path: p, folder: root, global: true})
		}
	}
	projDirs, err := os.ReadDir(filepath.Join(root, "projects"))
	if err != nil {
		return rtn
	}
	for _, d := range projDirs {
		if !d.IsDir() {
			continue
		}
		projDir := filepath.Join(root, "projects", d.Name())
		sessionFiles, _ := filepath.Glob(filepath.Join(projDir, "*.jsonl"))
		var memFiles []string
		if memory {
			memFiles, _ = filepath.Glob(filepath.Join(projDir, "memory", "*.md"))
		}
		if len(sessionFiles) == 0 && len(memFiles) == 0 {
			continue
		}
		folder := findProjectCwd(sessionFiles)
		if folder == "" {
			folder = decodeProjectDirName(d.Name())
		}
		folder = normalizePath(folder)
		_, statErr := os.Stat(folder)
		missing := statErr != nil
		if sessions {
			for _, p := range sessionFiles {
				rtn = append(rtn, searchFile{path: p, folder: folder, missing: missing, isSession: true})
			}
		}
		for _, p := range memFiles {
			rtn = append(rtn, searchFile{path: p, folder: folder, missing: missing})
		}
	}
	return rtn
}

// findProjectCwd reads the head of the project's session files until one records a cwd. All sessions in a
// project dir share it, because Claude Code names the dir after the cwd.
func findProjectCwd(sessionFiles []string) string {
	for _, p := range sessionFiles {
		if cwd := probeCwd(p); cwd != "" {
			return cwd
		}
	}
	return ""
}

func probeCwd(path string) string {
	fd, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer fd.Close()
	r := bufio.NewReaderSize(fd, ReadBufferSize)
	cwdKey := []byte(`"cwd":"`)
	for i := 0; i < MaxCwdProbeLines; i++ {
		line, err := readLine(r)
		if len(line) > 0 && bytes.Contains(line, cwdKey) {
			var rec claudeRecord
			if json.Unmarshal(line, &rec) == nil && rec.Cwd != "" {
				return rec.Cwd
			}
		}
		if err != nil {
			return ""
		}
	}
	return ""
}

// encodeProjectName mirrors how Claude Code names a project dir: every non-alphanumeric char of the cwd becomes "-".
func encodeProjectName(s string) string {
	var sb strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			sb.WriteRune(r)
		} else {
			sb.WriteByte('-')
		}
	}
	return sb.String()
}

// decodeProjectDirName recovers the cwd for a project dir that has no session files to read it from.
// The encoding is lossy ("-" may have been "\", "-", ".", " "...), so walk the real filesystem looking
// for the path whose encoding matches. Falls back to the raw name when the folder no longer exists.
func decodeProjectDirName(name string) string {
	var roots []string
	if runtime.GOOS == "windows" {
		if len(name) >= 3 && isAsciiLetter(name[0]) && name[1:3] == "--" {
			roots = append(roots, strings.ToUpper(name[:1])+":\\")
		}
	} else {
		roots = append(roots, "/")
	}
	for _, root := range roots {
		if found := walkEncoded(root, encodeProjectName(root), name, 0); found != "" {
			return found
		}
	}
	return name
}

func walkEncoded(dir string, dirEnc string, target string, depth int) string {
	if dirEnc == target || (strings.HasSuffix(dirEnc, "-") && strings.TrimSuffix(dirEnc, "-") == target) {
		return dir
	}
	if depth > 12 || !strings.HasPrefix(target, dirEnc) {
		return ""
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		childEnc := dirEnc + encodeProjectName(e.Name())
		if !strings.HasSuffix(dirEnc, "-") {
			childEnc = dirEnc + "-" + encodeProjectName(e.Name())
		}
		if childEnc != target && !strings.HasPrefix(target, childEnc+"-") {
			continue
		}
		if found := walkEncoded(filepath.Join(dir, e.Name()), childEnc, target, depth+1); found != "" {
			return found
		}
	}
	return ""
}

// readLine returns one full line regardless of length (tool results can make a JSONL line many MB).
func readLine(r *bufio.Reader) ([]byte, error) {
	line, err := r.ReadSlice('\n')
	if err != bufio.ErrBufferFull {
		return line, err
	}
	buf := append([]byte(nil), line...)
	for err == bufio.ErrBufferFull {
		line, err = r.ReadSlice('\n')
		buf = append(buf, line...)
	}
	return buf, err
}

func lowerAsciiInto(dst []byte, src []byte) []byte {
	dst = dst[:0]
	for _, c := range src {
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		dst = append(dst, c)
	}
	return dst
}

func searchSessionFile(path string, m *matcher) (int, int64, []wshrpc.AgentSnippet, error) {
	fd, err := os.Open(path)
	if err != nil {
		return 0, 0, nil, err
	}
	defer fd.Close()
	r := bufio.NewReaderSize(fd, ReadBufferSize)
	var matches int
	var lastTs int64
	var snippets []wshrpc.AgentSnippet
	var lowerBuf []byte
	for {
		line, readErr := readLine(r)
		if len(line) > 0 {
			lowerBuf = lowerAsciiInto(lowerBuf, line)
			if m.rawMatch(lowerBuf) {
				n, ts, snip := matchSessionLine(line, m)
				if n > 0 {
					matches += n
					if ts > lastTs {
						lastTs = ts
					}
					if snip != "" && len(snippets) < MaxSnippetsPerFolder {
						snippets = append(snippets, wshrpc.AgentSnippet{Kind: SnippetKindSession, Text: snip, Ts: ts, File: path})
					}
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return matches, lastTs, snippets, readErr
		}
	}
	return matches, lastTs, snippets, nil
}

// matchSessionLine counts matches only in what the user and Claude wrote. Tool calls and tool results are
// skipped: they contain every file Claude read, which would turn most keywords into noise.
func matchSessionLine(line []byte, m *matcher) (int, int64, string) {
	var rec claudeRecord
	if err := json.Unmarshal(line, &rec); err != nil {
		return 0, 0, ""
	}
	if (rec.Type != "user" && rec.Type != "assistant") || rec.IsMeta || len(rec.Message) == 0 {
		return 0, 0, ""
	}
	var msg claudeMessage
	if err := json.Unmarshal(rec.Message, &msg); err != nil {
		return 0, 0, ""
	}
	text := extractMessageText(msg.Content)
	if text == "" {
		return 0, 0, ""
	}
	count, snip := countAndSnippet(text, m.lower)
	if count == 0 {
		return 0, 0, ""
	}
	return count, parseTs(rec.Timestamp), snip
}

func extractMessageText(content json.RawMessage) string {
	if len(content) == 0 {
		return ""
	}
	if content[0] == '"' {
		var s string
		if json.Unmarshal(content, &s) == nil {
			return s
		}
		return ""
	}
	var blocks []claudeContentBlock
	if json.Unmarshal(content, &blocks) != nil {
		return ""
	}
	var sb strings.Builder
	for _, b := range blocks {
		if b.Type != "text" || b.Text == "" {
			continue
		}
		if sb.Len() > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString(b.Text)
	}
	return sb.String()
}

func parseTs(s string) int64 {
	if s == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return 0
	}
	return t.UnixMilli()
}

func searchMemoryFile(path string, m *matcher) (int, int64, []wshrpc.AgentSnippet, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, 0, nil, err
	}
	count, snip := countAndSnippet(string(data), m.lower)
	if count == 0 {
		return 0, 0, nil, nil
	}
	var ts int64
	if info, err := os.Stat(path); err == nil {
		ts = info.ModTime().UnixMilli()
	}
	return count, ts, []wshrpc.AgentSnippet{{Kind: SnippetKindMemory, Text: snip, Ts: ts, File: path}}, nil
}

func countAndSnippet(text string, lowerQuery string) (int, string) {
	lowerText := strings.ToLower(text)
	count := strings.Count(lowerText, lowerQuery)
	if count == 0 {
		return 0, ""
	}
	idx := strings.Index(lowerText, lowerQuery)
	// strings.ToLower can change byte lengths for some non-ASCII runes; fall back to the head of the text
	if len(lowerText) != len(text) {
		idx = 0
	}
	return count, makeSnippet(text, idx, len(lowerQuery))
}

func makeSnippet(text string, idx int, qlen int) string {
	start := idx - SnippetContextBefore
	end := idx + qlen + SnippetContextAfter
	prefix, suffix := "…", "…"
	if start <= 0 {
		start, prefix = 0, ""
	}
	if end >= len(text) {
		end, suffix = len(text), ""
	}
	for start > 0 && !isRuneStart(text[start]) {
		start--
	}
	for end < len(text) && !isRuneStart(text[end]) {
		end++
	}
	return prefix + collapseSpace(text[start:end]) + suffix
}

func isRuneStart(b byte) bool {
	return b&0xC0 != 0x80
}

func collapseSpace(s string) string {
	var sb strings.Builder
	lastSpace := false
	for _, r := range s {
		if unicode.IsSpace(r) {
			if !lastSpace {
				sb.WriteRune(' ')
			}
			lastSpace = true
			continue
		}
		sb.WriteRune(r)
		lastSpace = false
	}
	return strings.TrimSpace(sb.String())
}
