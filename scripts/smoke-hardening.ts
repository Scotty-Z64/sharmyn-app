import "dotenv/config";
import mysql from "mysql2/promise";
import { placeOrderTx, customerCancelOrder, findPublicOrder, findOrder } from "../api/queries/shop";

async function main() {
  const url = process.env.DATABASE_URL!;
  const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });

  // pick any in-stock product
  const [prows] = await conn.query("SELECT id, name, price, quantity FROM products WHERE quantity > 1 LIMIT 1");
  const p = (prows as { id: string; name: string; price: number; quantity: number }[])[0];
  if (!p) throw new Error("no product with stock");
  console.log("Using product:", p);

  // 1) place order — client CANNOT influence price; expect total = db price*qty + door fee 80
  const order = await placeOrderTx(
    { name: "SMOKE TEST", phone: "0000000000", email: "smoke@test.dev", address: "", city: "", notes: "smoke" },
    [{ productId: p.id, qty: 1 }],
    { method: "door" }
  );
  console.log("Placed:", order.id, "total:", order.total, "expected:", p.price + 80, "itemPrice:", order.items[0].price, "expected:", p.price);
  if (order.total !== p.price + 80) throw new Error("SERVER PRICE NOT USED");
  if (order.items[0].price !== p.price) throw new Error("ITEM PRICE NOT FROM DB");

  // stock decremented?
  const [q1] = await conn.query("SELECT quantity FROM products WHERE id = ?", [p.id]);
  const qAfter = (q1 as { quantity: number }[])[0].quantity;
  console.log("qty after order:", qAfter, "expected:", p.quantity - 1);
  if (qAfter !== p.quantity - 1) throw new Error("STOCK NOT DECREMENTED");

  // 2) POPIA: wrong email -> null (oracle-safe)
  const wrong = await findPublicOrder(order.id, "wrong@test.dev");
  console.log("wrong-email lookup:", wrong === null ? "null (OK)" : "LEAKED!");
  const right = await findPublicOrder(order.id, "Smoke@Test.DEV");
  console.log("right-email lookup keys:", right ? Object.keys(right).join(",") : "null");
  if (right && JSON.stringify(right).includes("smoke@test.dev")) throw new Error("EMAIL LEAKED IN PUBLIC PROJECTION");

  // 3) customer cancel -> stock restored
  const cancelled = await customerCancelOrder(order.id, "smoke@test.dev");
  console.log("cancelled status:", cancelled?.status);
  const [q2] = await conn.query("SELECT quantity FROM products WHERE id = ?", [p.id]);
  const qRestored = (q2 as { quantity: number }[])[0].quantity;
  console.log("qty after cancel:", qRestored, "expected:", p.quantity);
  if (qRestored !== p.quantity) throw new Error("STOCK NOT RESTORED");

  // cleanup: delete test order + its notifications
  await conn.query("DELETE FROM orders WHERE id = ?", [order.id]);
  await conn.query("DELETE FROM notifications WHERE order_id = ?", [order.id]);
  const check = await findOrder(order.id);
  console.log("cleanup:", check === null ? "order deleted (OK)" : "STILL PRESENT");
  await conn.end();
  console.log("SMOKE OK");
}

main().catch((e) => { console.error("SMOKE FAILED:", e); process.exit(1); });
