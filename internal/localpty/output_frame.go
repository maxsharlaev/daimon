package localpty

import "bytes"

// emitPrefix returns a prefix of buf safe to forward to the terminal emulator.
// It keeps a trailing fragment when it might be an incomplete escape sequence.
func emitPrefix(buf []byte) (emit []byte, rest []byte) {
	if len(buf) == 0 {
		return nil, nil
	}
	if !endsWithIncompleteEscape(buf) {
		return buf, nil
	}
	i := bytes.LastIndexByte(buf, 0x1b)
	if i < 0 {
		return buf, nil
	}
	if i == 0 {
		return nil, buf
	}
	return buf[:i], buf[i:]
}

func endsWithIncompleteEscape(b []byte) bool {
	start := bytes.LastIndexByte(b, 0x1b)
	if start < 0 {
		return false
	}
	tail := b[start:]
	if len(tail) == 1 {
		return true
	}
	switch tail[1] {
	case '[':
		for _, c := range tail[2:] {
			if c >= 0x40 && c <= 0x7e {
				return false
			}
		}
		return true
	case ']':
		if bytes.Contains(tail, []byte{'\x07'}) {
			return false
		}
		if bytes.HasSuffix(tail, []byte("\x1b\\")) {
			return false
		}
		return true
	case 'P':
		if bytes.HasSuffix(tail, []byte("\x1b\\")) {
			return false
		}
		return true
	case '(', ')', '*', '+', '-', '.', '/':
		return len(tail) < 3
	default:
		return false
	}
}
