// index.ts
import express from "express";
import { Pool } from "pg";
import "dotenv/config";

import { crearVentaRouter } from "./routes/venta.routes";
import { crearCajaRouter } from "./routes/caja.routes";
import { crearInventarioRouter } from "./routes/inventario.routes";
import { crearClienteRouter } from "./routes/cliente.routes";

const app = express();
app.use(express.json());

// Instanciamos el Pool leyendo las variables de entorno de forma segura
const dbPool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Montamos los routers inyectando la conexión a la base de datos
app.use("/api/ventas", crearVentaRouter(dbPool));
app.use("/api/caja", crearCajaRouter(dbPool));
app.use("/api/inventario", crearInventarioRouter(dbPool));
app.use("/api/clientes", crearClienteRouter(dbPool));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo de forma segura en el puerto ${PORT}`);
});

//npm run dev
