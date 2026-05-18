function parseLongTextReviewBlocks(value) {
  const lines = String(value || "").replace(/\r\n/gu, "\n").split("\n");
  const blocks = [];
  let paragraphLines = [];
  let listBlock = null;
  let codeLines = null;

  const flushParagraph = () => {
    const text = paragraphLines.join(" ").replace(/\s+/gu, " ").trim();
    paragraphLines = [];
    if (text) {
      blocks.push({
        text,
        type: "paragraph"
      });
    }
  };

  const flushList = () => {
    if (listBlock?.items.length) {
      blocks.push(listBlock);
    }
    listBlock = null;
  };

  const flushCode = () => {
    if (codeLines) {
      blocks.push({
        text: codeLines.join("\n").replace(/\n+$/u, ""),
        type: "code"
      });
    }
    codeLines = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/u, "");
    const trimmed = line.trim();

    if (codeLines) {
      if (/^```/u.test(trimmed)) {
        flushCode();
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (/^```/u.test(trimmed)) {
      flushParagraph();
      flushList();
      codeLines = [];
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/u);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
        type: "heading"
      });
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.*)$/u);
    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.*)$/u);
    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const type = orderedMatch ? "ol" : "ul";
      if (!listBlock || listBlock.type !== type) {
        flushList();
        listBlock = {
          items: [],
          type
        };
      }
      listBlock.items.push({
        text: (orderedMatch?.[1] || unorderedMatch?.[1] || "").trim()
      });
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushCode();
  return blocks;
}

export { parseLongTextReviewBlocks };
