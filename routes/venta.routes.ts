// routes/venta.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { VentaRepository } from "../repositories/VentaRepository";
import { ProductoRepository } from "../repositories/ProductoRepository";
import { VentaService } from "../services/VentaService";
import { VentaController } from "../controllers/VentaController";

export function crearVentaRouter(dbPool: Pool): Router {
  const router = Router();

  const ventaRepository = new VentaRepository(dbPool);
  const productoRepository = new ProductoRepository(dbPool);

  const ventaService = new VentaService(ventaRepository, productoRepository);
  const ventaController = new VentaController(ventaService);

  // Rutas estáticas primero
  router.get("/", ventaController.obtenerVentas);
  router.post("/orden", ventaController.crearOrden);
  router.get(
    "/repartidores/activos",
    ventaController.obtenerRepartidoresActivos,
  );
  router.get(
    "/autorizaciones/pendientes",
    ventaController.obtenerAutorizacionesPendientes,
  );
  router.post("/autorizaciones/resolver", ventaController.resolverAutorizacion);

  // Rutas dinámicas (/:id) AL FINAL
  router.get("/:id", ventaController.obtenerVentaPorId);

  return router;
}
