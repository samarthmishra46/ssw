import { redirect } from "next/navigation";
import { DEFAULT_CENTRE } from "@ssw/content";

/** proxy.ts normally redirects first; this covers the root if the proxy is skipped. */
export default function Home() {
  redirect(`/${DEFAULT_CENTRE}`);
}
