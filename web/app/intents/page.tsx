import { redirect } from "next/navigation";

// Signed swaps are part of the deals list now. Kept so old links still land somewhere useful.
export default function IntentsRedirect() {
  redirect("/deals");
}
