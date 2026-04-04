// routes/pedido.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { PedidoRepository } from "../repositories/PedidoRepository";
import { PedidoService } from "../services/PedidoService";
import { PedidoController } from "../controllers/PedidoController";

export function crearPedidoRouter(dbPool: Pool): Router {
  const router = Router();

  const pedidoRepository = new PedidoRepository(dbPool);
  const pedidoService = new PedidoService(pedidoRepository);
  const pedidoController = new PedidoController(pedidoService);

  // POST /api/pedidos/programar
  router.post("/programar", pedidoController.programarDespacho);

  // PUT /api/pedidos/:id/resultado
  router.put("/:id/resultado", pedidoController.reportarResultado);

  return router;
}
