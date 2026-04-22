// index.ts
import express, { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import cors from "cors";
import "dotenv/config";
import { verificarToken } from "./middlewares/auth.middleware";
import { asignarPoolPorRol } from "./middlewares/db.middleware";
import { poolAdmin } from "./db";

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
import { crearAnulacionRouter } from "./routes/anulacion.routes";

const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:3001",
      "https://frontend-refaccionaria-franco.vercel.app",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());

app.use("/api/auth", crearAuthRouter(poolAdmin));

app.use(verificarToken);
app.use(asignarPoolPorRol);

const routerDinamico = (crearRouter: (pool: Pool) => express.Router) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const pool = req.dbPool!;
    crearRouter(pool)(req, res, next);
  };
};

app.use("/api/ventas", routerDinamico(crearVentaRouter));
app.use("/api/caja", routerDinamico(crearCajaRouter));
app.use("/api/inventario", routerDinamico(crearInventarioRouter));
app.use("/api/clientes", routerDinamico(crearClienteRouter));
app.use("/api/pedidos", routerDinamico(crearPedidoRouter));
app.use("/api/arqueos", routerDinamico(crearArqueoRouter));
app.use("/api/garantias", routerDinamico(crearGarantiaRouter));
app.use("/api/metas", routerDinamico(crearMetaRouter));
app.use("/api/bodega", routerDinamico(crearBodegaRouter));
app.use("/api/ubicaciones", routerDinamico(crearUbicacionRouter));
app.use("/api/entregas", routerDinamico(crearEntregaRouter));
app.use("/api/ventas", routerDinamico(crearAnulacionRouter));

app.use("/api/admin", routerDinamico(crearAdminRouter));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo de forma segura en el puerto ${PORT}`);
});
