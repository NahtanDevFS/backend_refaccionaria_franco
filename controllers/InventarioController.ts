// controllers/InventarioController.ts
import { Request, Response } from "express";
import { InventarioService } from "../services/InventarioService";

export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  consultarStock = async (req: Request, res: Response): Promise<void> => {
    try {
      const { query } = req.query;

      if (!query || typeof query !== "string") {
        res
          .status(400)
          .json({
            success: false,
            message:
              "Debe proporcionar un parámetro de búsqueda válido (?query=termino)",
          });
        return;
      }

      const resultado =
        await this.inventarioService.consultarStockCentralizado(query);

      res.status(200).json({
        success: true,
        ...resultado,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Error interno al buscar inventario",
      });
    }
  };
}
