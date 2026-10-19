import * as React from "react";
import { navigate } from "../router";

type Props = React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean; scroll?: boolean; replace?: boolean };

/** next/link 대체 — 앱 안 경로는 해시 주소로, 바깥 주소는 그대로 */
const Link = React.forwardRef<HTMLAnchorElement, Props>(function Link({ href, prefetch: _p, scroll: _s, replace, onClick, ...rest }, ref) {
  const internal = href.startsWith("/");
  return (
    <a
      ref={ref}
      href={internal ? `#${href}` : href}
      onClick={(e) => {
        onClick?.(e);
        if (!internal || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href, replace);
      }}
      {...rest}
    />
  );
});

export default Link;
