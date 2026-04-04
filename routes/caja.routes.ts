// routes/caja.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { VentaRepository } from "../repositories/VentaRepository";
import { PagoRepository } from "../repositories/PagoRepository";
import { MockFelService } from "../services/MockFelService";
import { CajaService } from "../services/CajaService";
import { CajaController } from "../controllers/CajaController";

export function crearCajaRouter(dbPool: Pool): Router {
  const router = Router();

  // 1. Instanciar Repositorios
  const ventaRepository = new VentaRepository(dbPool);
  const pagoRepository = new PagoRepository(dbPool);

  // 2. Instanciar Servicio Externo (Simulador SAT)
  const felService = new MockFelService();

  // 3. Instanciar Servicio de Negocio
  const cajaService = new CajaService(
    ventaRepository,
    pagoRepository,
    felService,
  );

  // 4. Instanciar Controlador
  const cajaController = new CajaController(cajaService);

  // 5. Definir la ruta REST
  router.post("/pagar", cajaController.registrarPago);

  return router;
}
