// controllers/InventarioController.ts
import { Request, Response } from "express";
import { InventarioService } from "../services/InventarioService";

export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  consultarStock = async (req: Request, res: Response): Promise<void> => {
    try {
      const { q } = req.query;
      const resultado = await this.inventarioService.consultarStockCentralizado(
        q as string,
      );
      res.json(resultado);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  obtenerCategorias = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.inventarioService.obtenerCategorias());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  obtenerMarcasRepuesto = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      res.json(await this.inventarioService.obtenerMarcasRepuesto());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  buscarMultiSucursal = async (req: Request, res: Response): Promise<void> => {
    try {
      const termino = req.query.q as string;
      const idSucursalLocal = Number(req.query.id_sucursal);
      const idCategoria = req.query.id_categoria
        ? Number(req.query.id_categoria)
        : undefined;
      const idMarca = req.query.id_marca
        ? Number(req.query.id_marca)
        : undefined;

      if (!idSucursalLocal) {
        res.status(400).json({ error: "id_sucursal es requerido." });
        return;
      }

      // Validamos que al menos escriba algo o seleccione un filtro
      if ((!termino || termino.length < 3) && !idCategoria && !idMarca) {
        res.status(400).json({
          error:
            "Debe ingresar un término de búsqueda (mín. 3 letras) o seleccionar una categoría/marca.",
        });
        return;
      }

      const productos =
        await this.inventarioService.buscarProductoMultiSucursal(
          idSucursalLocal,
          termino,
          idCategoria,
          idMarca,
        );
      res.json(productos);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  // ==========================================
  // RUTAS PARA VEHÍCULOS Y COMPATIBILIDAD
  // ==========================================

  obtenerMarcasVehiculo = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const marcas = await this.inventarioService.obtenerMarcasVehiculo();
      res.json(marcas);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  obtenerModelosPorMarca = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const id_marca = Number(req.params.id_marca);
      if (!id_marca) {
        res
          .status(400)
          .json({ error: "Debe proporcionar un id_marca válido." });
        return;
      }
      const modelos =
        await this.inventarioService.obtenerModelosPorMarca(id_marca);
      res.json(modelos);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  buscarPorVehiculo = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal =
        Number(req.query.id_sucursal) || Number(req.usuario?.id_sucursal);
      const id_modelo = Number(req.query.id_modelo);
      const anio = req.query.anio ? Number(req.query.anio) : undefined;
      const idCategoria = req.query.id_categoria
        ? Number(req.query.id_categoria)
        : undefined;
      const idMarca = req.query.id_marca
        ? Number(req.query.id_marca)
        : undefined;

      if (!id_sucursal || !id_modelo) {
        res
          .status(400)
          .json({ error: "id_sucursal y id_modelo son requeridos." });
        return;
      }

      const productos = await this.inventarioService.buscarProductosPorVehiculo(
        id_sucursal,
        id_modelo,
        anio,
        idCategoria,
        idMarca,
      );
      res.json(productos);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  obtenerCompatibilidades = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const id_producto = Number(req.params.id_producto);
      if (!id_producto) {
        res
          .status(400)
          .json({ error: "Debe proporcionar un id_producto válido." });
        return;
      }
      const compatibilidades =
        await this.inventarioService.obtenerCompatibilidadesProducto(
          id_producto,
        );
      res.json(compatibilidades);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}
