import { decodeHTMLAttribute } from 'entities';

/** 解码 Markdown 链接目标中的 HTML 字符引用 */
export function decodeHtmlCharacterReferences(value: string): string {
  return decodeHTMLAttribute(value);
}
