import * as HtmlCreator from 'html-creator';

export interface HtmlNode {
  type: string;
  attributes?: {};
  content?: HtmlNode[] | string;
}

export interface TextHtmlNode extends HtmlNode {
  content: string;
}

export interface BlockHtmlNode extends HtmlNode {
  content: HtmlNode[];
}

export interface SingleHtmlNode extends HtmlNode {
  content: never;
}

export function tag(type: string): SingleHtmlNode;
export function tag(type: string, content: string): TextHtmlNode;
export function tag(type: string, content: HtmlNode[]): BlockHtmlNode;
export function tag(type: string, className: string, content: string): TextHtmlNode;
export function tag(type: string, className: string, content: HtmlNode[]): BlockHtmlNode;

export function tag(type: string, arg1?: any, arg2?: any): HtmlNode {
  if (arg2) {
    return _tag(type, arg1, arg2);
  } else {
    return _tag(type, undefined, arg1);
  }
}

export function table(headings: string[]): BlockHtmlNode {
  return tag('table', [
    tag('thead', [
      tag('tr', headings.map(h => tag('th', h)))
    ])
  ])
}

export function tr(cells: (string | HtmlNode)[]): BlockHtmlNode {
  return tag('tr', cells.map(c => typeof c === 'string' ? tag('td', c) : tag('td', [ c ])));
}

function _tag(type: string, className: string | undefined, content: HtmlNode[] | string): HtmlNode {
  if (className) {
    return {
      type,
      attributes: { class: className },
      content,
    };
  } else {
    return {
      type,
      content,
    }
  }
}

export function a(text: string, href: string, className?: string) {
  if (className) {
    return {
      type: 'a',
      attributes: {
        class: className,
        href: href,
      },
      content: text,
    };
  } else {
    return {
      type: 'a',
      attributes: {
        href: href,
      },
      content: text,
    };
  }
}

export function emit(styles: string[], content: HtmlNode[]): string {
  return new HtmlCreator([
    tag('head', [
      ...styles.map(s => ({
        type: 'link',
        attributes: {
          rel: 'stylesheet',
          type: 'text/css',
          href: s
        }
      }))
    ]),
    tag('body', content)
  ]).renderHTML();
}
