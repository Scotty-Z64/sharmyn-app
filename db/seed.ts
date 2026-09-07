import { getDb } from "../api/queries/connection";
import { products, orders } from "./schema";

const now = new Date();
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400000);
const hrsAgo = (h: number) => new Date(Date.now() - h * 3600000);

type P = typeof products.$inferInsert;
const p = (
  id: string, name: string, category: P["category"], price: number,
  description: string, image: string, availability: P["availability"],
  quantity: number, featured = false, backDate?: Date
): P => ({ id, name, category, price, description, image, availability, quantity, featured, backDate, createdAt: now });

async function seed() {
  const db = getDb();
  console.log("Seeding database...");

  const existing = await db.select().from(products).limit(1);
  if (existing.length) {
    console.log("Products already present — skipping seed.");
    process.exit(0);
  }

  await db.insert(products).values([
    // Sneakers
    p("snk-1", "Rose Runner Sneaker", "sneakers", 1499,
      "Buttery white leather with rose-gold trims — the pair that turns errands into entrances. Cushioned all-day sole, fits true to size.",
      "/product-sneaker-1.png", "in-stock", 12, true),
    p("snk-2", "Blush Chunky", "sneakers", 1299,
      "A cloud-soft chunky silhouette in powder blush with a crisp white sole. Street-soft, statement-sweet.",
      "/product-sneaker-2.png", "in-stock", 8),
    p("snk-3", "Nude Sprint", "sneakers", 1199,
      "Sleek nude runner with gold-tipped laces. Feather-light and endlessly pairable.",
      "/product-sneaker-3.png", "back-soon", 0, false, daysFromNow(14)),
    p("snk-4", "Satin High-Top", "sneakers", 1599,
      "Rose-pink high-top laced with satin ribbon. Sold out fast — restock whispers soon.",
      "/product-sneaker-4.png", "sold-out", 0),
    // Jewellery
    p("jwl-1", "Custom Name Bracelet", "jewellery", 649,
      "Your name, hand-set in flowing gold script. Made to order in our Joburg studio — allow 5 working days.",
      "/product-jewel-3.png", "in-stock", 20, true),
    p("jwl-2", "Rose Quartz Necklace", "jewellery", 899,
      "A dreamy rose quartz pendant on a delicate gold chain. Soft light, caught forever.",
      "/product-jewel-1.png", "in-stock", 10),
    p("jwl-3", "Crystal Hoops", "jewellery", 499,
      "Rose-gold hoops scattered with tiny crystals. Everyday sparkle, zero effort.",
      "/product-jewel-2.png", "in-stock", 15),
    p("jwl-4", "Enamel Bangle Stack", "jewellery", 799,
      "A trio of gold bangles kissed with blush enamel. Stack them, gift them, live in them.",
      "/product-jewel-4.png", "sold-out", 0),
    // Handbags
    p("bag-1", "Quilted Mini Bag", "handbags", 1899,
      "Our signature quilted mini in powder blush with a gold clasp. Fits phone, gloss and confidence.",
      "/product-bag-1.png", "in-stock", 6, true),
    p("bag-2", "Cream Tote", "handbags", 1499,
      "Structured cream tote with rose-pink handles and gold hardware. Work-to-weekend, beautifully.",
      "/product-bag-2.png", "in-stock", 9),
    p("bag-3", "Chain Crossbody", "handbags", 1299,
      "Mini rose crossbody on a fine gold chain. Hands-free, heart full.",
      "/product-bag-3.png", "back-soon", 0, false, daysFromNow(7)),
    p("bag-4", "Gold Clutch", "handbags", 999,
      "Champagne-gold evening clutch with a crystal clasp. The last thing you put on, the first they notice.",
      "/product-bag-4.png", "in-stock", 5),
    // Clothing
    p("clo-1", "Satin Slip Dress", "clothing", 1099,
      "Bias-cut blush satin that pours like water. Daylight to date-night in one slip.",
      "/product-cloth-1.png", "in-stock", 7, true),
    p("clo-2", "Pearl Cardigan", "clothing", 899,
      "Cloud-soft cream knit finished with pearl buttons. The gentle layer your wardrobe begged for.",
      "/product-cloth-2.png", "in-stock", 11),
    p("clo-3", "Puff-Sleeve Blouse", "clothing", 749,
      "Rose-pink blouse with romantic puff sleeves. Boardroom polish, boutique soul.",
      "/product-cloth-3.png", "in-stock", 9),
    p("clo-4", "Pleated Skirt", "clothing", 949,
      "High-waist champagne pleats that move like music. Currently twirling off our shelves.",
      "/product-cloth-4.png", "sold-out", 0),
  ]);

  await db.insert(orders).values([
    {
      id: "SH-100234",
      items: [
        { productId: "snk-1", name: "Rose Runner Sneaker", price: 1499, qty: 1 },
        { productId: "jwl-3", name: "Crystal Hoops", price: 499, qty: 1 },
      ],
      customer: { name: "Lerato Mokoena", phone: "082 555 0134", email: "lerato@example.com", address: "12 Rosebank Ave", city: "Johannesburg", notes: "" },
      delivery: { method: "pudo", locker: { id: "PTL123", name: "Pudo Locker Rosebank Mall", address: "Rosebank Mall, Bath Ave", city: "Johannesburg", province: "Gauteng" }, fee: 60 },
      total: 2058,
      status: "shipped",
      statusHistory: [
        { status: "pending", at: hrsAgo(72).toISOString() },
        { status: "processing", at: hrsAgo(48).toISOString() },
        { status: "shipped", at: hrsAgo(12).toISOString() },
      ],
      createdAt: hrsAgo(72),
    },
    {
      id: "SH-100187",
      items: [{ productId: "jwl-1", name: "Custom Name Bracelet", price: 649, qty: 2 }],
      customer: { name: "Ayesha Khan", phone: "083 555 0187", email: "ayesha@example.com", address: "45 Palm Blvd", city: "Durban", notes: "Gift wrap please" },
      delivery: { method: "door", fee: 80 },
      total: 1378,
      status: "delivered",
      statusHistory: [
        { status: "pending", at: hrsAgo(240).toISOString() },
        { status: "processing", at: hrsAgo(200).toISOString() },
        { status: "shipped", at: hrsAgo(150).toISOString() },
        { status: "delivered", at: hrsAgo(96).toISOString() },
      ],
      createdAt: hrsAgo(240),
    },
  ]);

  console.log("Done. Seeded 16 products + 2 orders.");
  process.exit(0);
}

seed();
