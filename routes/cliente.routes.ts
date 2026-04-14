// routes/cliente.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { ClienteService } from "../services/ClienteService";
import { ClienteController } from "../controllers/ClienteController";

export function crearClienteRouter(dbPool: Pool): Router {
  const router = Router();

  const clienteService = new ClienteService(dbPool);
  const clienteController = new ClienteController(clienteService);

  router.post("/", clienteController.crearCliente);
  router.get("/buscar", clienteController.buscarPorNit);

  return router;
}
