import type { ComponentChildren } from 'preact';

/** An external link that opens in a new tab (an extension popup closes when a page opens, so it must be a tab). */
export function ExternalLink({ href, onOpen, children }: { href: string; onOpen(url: string): void; children: ComponentChildren }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onOpen(href);
      }}
    >
      {children}
    </a>
  );
}
