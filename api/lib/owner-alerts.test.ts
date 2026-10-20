import { afterEach, describe, expect, it } from "vitest";
import { ownerWhatsAppNumbers } from "./whatsapp";

const SHARMYN = "27616455670";
const keep = process.env.OWNER_WHATSAPP;
afterEach(() => {
  if (keep === undefined) delete process.env.OWNER_WHATSAPP;
  else process.env.OWNER_WHATSAPP = keep;
});

describe("who gets the owner WhatsApp alerts", () => {
  it("is always the Sharmyn number, even when nothing is set", () => {
    delete process.env.OWNER_WHATSAPP;
    expect(ownerWhatsAppNumbers()).toEqual([SHARMYN]);
  });

  it("keeps the Sharmyn number when another phone is added", () => {
    process.env.OWNER_WHATSAPP = "082 123 4567";
    expect(ownerWhatsAppNumbers()).toEqual([SHARMYN, "27821234567"]);
  });

  it("takes several phones separated by commas, and never lists a phone twice", () => {
    process.env.OWNER_WHATSAPP = "0821234567, 061 645 5670; +27 82 123 4567";
    expect(ownerWhatsAppNumbers()).toEqual([SHARMYN, "27821234567"]);
  });

  it("ignores a setting that is not a phone number", () => {
    process.env.OWNER_WHATSAPP = "not a number";
    expect(ownerWhatsAppNumbers()).toEqual([SHARMYN]);
  });
});
