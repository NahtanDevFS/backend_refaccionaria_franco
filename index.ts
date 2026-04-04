// app.ts (Ejemplo rápido de cómo se monta)
import express from "express";
import { Pool } from "pg";
import { crearVentaRouter } from "./routes/venta.routes";

const app = express();
app.use(express.json()); // CRÍTICO para poder leer req.body

const dbPool = new Pool({
  host: "localhost",
  port: 5432,
  database: "proyecto_refaccionaria_franco",
  user: "postgres",
  password: "pass123",
});

// Montamos el router
app.use("/api/ventas", crearVentaRouter(dbPool));

app.listen(3000, () => console.log("Servidor corriendo en el puerto 3000"));

//npm run dev
