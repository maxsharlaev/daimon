import DOMPurify from "dompurify";
import { useMemo } from "react";
import { marked } from "marked";

type Props = {
  text: string;
};

marked.setOptions({ breaks: true });

export function AgentAssistantMarkdown({ text }: Props) {
  const html = useMemo(() => {
    const t = text.trim();
    if (!t) return "";
    try {
      const raw = marked.parse(t) as string;
      return DOMPurify.sanitize(raw);
    } catch {
      return DOMPurify.sanitize(t);
    }
  }, [text]);

  if (!html) {
    return null;
  }

  return <div className="agent-md-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
