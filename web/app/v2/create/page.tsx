import { redirect } from "next/navigation";

/** Create moved into one guided flow at /create. Keeps old links working. */
export default function CreateV2Redirect() {
  redirect("/create");
}
