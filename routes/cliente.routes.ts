// routes/cliente.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { ClienteRepository } from "../repositories/ClienteRepository";
import { ClienteService } from "../services/ClienteService";
import { ClienteController } from "../controllers/ClienteController";

export function crearClienteRouter(dbPool: Pool): Router {
  const router = Router();

  const clienteRepository = new ClienteRepository(dbPool);
  const clienteService = new ClienteService(clienteRepository);
  const clienteController = new ClienteController(clienteService);

  // Endpoints
  router.post("/", clienteController.crearCliente);
  router.get("/buscar", clienteController.buscarClientes);

  return router;
}
