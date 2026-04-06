// routes/venta.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { VentaRepository } from "../repositories/VentaRepository";
// Asumiendo que crearás este repositorio pronto:
import { ProductoRepository } from "../repositories/ProductoRepository";
import { VentaService } from "../services/VentaService";
import { VentaController } from "../controllers/VentaController";

export function crearVentaRouter(dbPool: Pool): Router {
  const router = Router();

  // 1. Instanciamos los repositorios pasándoles el Pool de PostgreSQL
  const ventaRepository = new VentaRepository(dbPool);
  const productoRepository = new ProductoRepository(dbPool);

  // 2. Instanciamos el servicio inyectándole sus dependencias
  const ventaService = new VentaService(ventaRepository, productoRepository);

  // 3. Instanciamos el controlador inyectándole el servicio
  const ventaController = new VentaController(ventaService);

  // 4. Definimos la ruta RESTful
  // Usamos POST porque estamos creando un nuevo recurso (una venta)
  router.get("/", ventaController.obtenerVentas);
  router.post("/orden", ventaController.crearOrden);
  router.get(
    "/repartidores/activos",
    ventaController.obtenerRepartidoresActivos,
  );

  return router;
}
