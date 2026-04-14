// routes/pedido.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { PedidoService } from "../services/PedidoService";
import { PedidoController } from "../controllers/PedidoController";

export function crearPedidoRouter(dbPool: Pool): Router {
  const router = Router();
  const pedidoService = new PedidoService(dbPool);
  const pedidoController = new PedidoController(pedidoService);

  router.post("/programar", pedidoController.programarDespacho);
  router.put("/:id/resultado", pedidoController.reportarResultado);

  return router;
}
