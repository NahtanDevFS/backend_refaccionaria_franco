import { Request, Response } from "express";
import { AnulacionService } from "../services/AnulacionService";

export class AnulacionController {
  constructor(private readonly anulacionService: AnulacionService) {}

  anularVenta = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_venta = Number(req.params.id);
      const id_usuario = req.usuario!.id_empleado;
      const { motivo_anulacion, monto_devolucion } = req.body;

      if (!motivo_anulacion || String(motivo_anulacion).trim().length < 5)
        throw new Error(
          "El motivo de anulación es obligatorio (mínimo 5 caracteres).",
        );

      if (isNaN(id_venta) || id_venta <= 0)
        throw new Error("ID de venta inválido.");

      const resultado = await this.anulacionService.anularVenta({
        id_venta,
        id_usuario,
        motivo_anulacion: String(motivo_anulacion).trim(),
        monto_devolucion: monto_devolucion ? Number(monto_devolucion) : 0,
      });

      res.status(200).json({
        success: true,
        message: "Venta anulada correctamente.",
        data: resultado,
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };
}
