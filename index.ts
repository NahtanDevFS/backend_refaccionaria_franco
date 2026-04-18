// index.ts
import express from "express";
import { Pool } from "pg";
import cors from "cors";
import "dotenv/config";
import { verificarToken } from "./middlewares/auth.middleware";

import { crearVentaRouter } from "./routes/venta.routes";
import { crearCajaRouter } from "./routes/caja.routes";
import { crearInventarioRouter } from "./routes/inventario.routes";
import { crearClienteRouter } from "./routes/cliente.routes";
import { crearPedidoRouter } from "./routes/pedido.routes";
import { crearArqueoRouter } from "./routes/arqueo.routes";
import { crearGarantiaRouter } from "./routes/garantia.routes";
import { crearMetaRouter } from "./routes/meta.routes";
import { crearAuthRouter } from "./routes/auth.routes";
import { crearBodegaRouter } from "./routes/bodega.routes";
import { crearUbicacionRouter } from "./routes/ubicacion.routes";
import { crearEntregaRouter } from "./routes/entrega.routes";
import { crearAdminRouter } from "./routes/admin.routes";

const app = express();

app.use(
  cors({
    origin: "http://localhost:3001", // Permite solo a tu frontend de Next.js
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"], // Vital si usas verificarToken
  }),
);

app.use(express.json());

// Instanciamos el Pool leyendo las variables de entorno de forma segura
const dbPool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

//ruta pública
app.use("/api/auth", crearAuthRouter(dbPool));

//se aplica el middleware a las rutas de abajo
app.use(verificarToken);

// Montamos los routers inyectando la conexión a la base de datos
app.use("/api/ventas", crearVentaRouter(dbPool));
app.use("/api/caja", crearCajaRouter(dbPool));
app.use("/api/inventario", crearInventarioRouter(dbPool));
app.use("/api/clientes", crearClienteRouter(dbPool));
app.use("/api/pedidos", crearPedidoRouter(dbPool));
app.use("/api/arqueos", crearArqueoRouter(dbPool));
app.use("/api/garantias", crearGarantiaRouter(dbPool));
app.use("/api/metas", crearMetaRouter(dbPool));
app.use("/api/bodega", crearBodegaRouter(dbPool));
app.use("/api/ubicaciones", crearUbicacionRouter(dbPool));
app.use("/api/entregas", crearEntregaRouter(dbPool));

// ── Rutas de administración — requieren token + rol ADMINISTRADOR ────────────
app.use("/api/admin", crearAdminRouter(dbPool));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo de forma segura en el puerto ${PORT}`);
});

//npm run dev
