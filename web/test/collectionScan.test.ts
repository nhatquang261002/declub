import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPublicAddress, readCapped, safeUrl, type Resolve } from "../lib/server/collectionScan";

const to = (...addresses: string[]): Resolve => async () => addresses.map((address) => ({ address }));
const PUBLIC = to("93.184.215.14");

describe("isPublicAddress", () => {
  it("refuses loopback, private, CGNAT, link-local, unique-local and mapped addresses", () => {
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "169.254.169.254", "0.0.0.0",
      "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8",
      "64:ff9b::7f00:1", "ff02::1", "not-an-ip",
    ]) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
  });

  it("allows public unicast addresses", () => {
    for (const ip of ["8.8.8.8", "93.184.215.14", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(ip), true, ip);
  });
});

describe("safeUrl", () => {
  it("allows https on a host that resolves to public addresses, and maps ipfs:// to the gateway", async () => {
    assert.equal((await safeUrl("https://meta.example.com/1.json", PUBLIC))?.href, "https://meta.example.com/1.json");
    assert.equal((await safeUrl("ipfs://bafyabc/1.json", PUBLIC))?.href, "https://ipfs.io/ipfs/bafyabc/1.json");
    assert.equal((await safeUrl("ipfs://ipfs/bafyabc/1.json", PUBLIC))?.href, "https://ipfs.io/ipfs/bafyabc/1.json");
  });

  it("refuses other schemes, credentials and literal IPs", async () => {
    for (const uri of ["http://meta.example.com/1", "file:///etc/passwd", "https://u:p@meta.example.com/", "https://127.0.0.1/", "https://[::1]/", "https://0x7f000001/", "nonsense"]) {
      assert.equal(await safeUrl(uri, PUBLIC), null, uri);
    }
  });

  it("refuses local names, with or without a trailing dot", async () => {
    for (const uri of ["https://localhost/", "https://localhost./", "https://a.localhost./", "https://metadata.google.internal./", "https://printer.local/", "https://intranet/"]) {
      assert.equal(await safeUrl(uri, PUBLIC), null, uri);
    }
  });

  it("refuses a name that resolves to any private address, or doesn't resolve", async () => {
    assert.equal(await safeUrl("https://127.0.0.1.nip.io/", to("127.0.0.1")), null);
    assert.equal(await safeUrl("https://mixed.example.com/", to("93.184.215.14", "10.0.0.5")), null);
    assert.equal(await safeUrl("https://mapped.example.com/", to("::ffff:169.254.169.254")), null);
    assert.equal(await safeUrl("https://nothing.example.com/", to()), null);
    assert.equal(await safeUrl("https://broken.example.com/", async () => { throw new Error("ENOTFOUND"); }), null);
  });
});

describe("readCapped", () => {
  const stream = (chunks: number, size: number) => {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ >= chunks) return controller.close();
        controller.enqueue(new Uint8Array(size).fill(0x20));
      },
    });
  };

  it("reads a body within the cap", async () => {
    assert.equal(await readCapped(new Response('{"a":1}'), 100), '{"a":1}');
  });

  it("refuses a declared length over the cap without reading", async () => {
    const res = new Response("x", { headers: { "content-length": "5000" } });
    assert.equal(await readCapped(res, 100), null);
  });

  it("stops reading a body that runs past the cap, however long it would go on", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(64));
      },
    });
    assert.equal(await readCapped(new Response(endless), 1_000), null);
    assert.ok(pulled < 40, `stopped after ${pulled} chunks`);
    assert.equal(await readCapped(new Response(stream(10, 100)), 999), null);
    assert.equal((await readCapped(new Response(stream(10, 100)), 1_000))?.length, 1_000);
  });
});
