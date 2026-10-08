import { redirect } from "next/navigation";

/** The Clubs guide became the main Guide at /guide. Keeps old links working; the browser keeps any #anchor. */
export default function ClubsGuideRedirect() {
  redirect("/guide");
}
