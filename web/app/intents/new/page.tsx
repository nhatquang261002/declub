import { redirect } from "next/navigation";

// Posting a signed swap is the "Sign only" choice on the Create screen.
export default function NewIntentRedirect() {
  redirect("/create");
}
