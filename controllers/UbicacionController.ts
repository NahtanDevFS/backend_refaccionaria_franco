import { Request, Response } from "express";
import { Pool } from "pg";

export class UbicacionController {
  constructor(private pool: Pool) {}

  obtenerDepartamentos = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.pool.query(
        "SELECT id_departamento, nombre FROM departamento WHERE activo = true ORDER BY nombre ASC",
      );
      res.status(200).json(result.rows);
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: "Error al obtener departamentos" });
    }
  };

  obtenerMunicipiosPorDepartamento = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const idDepto = parseInt(req.params.id as string);
      const result = await this.pool.query(
        "SELECT id_municipio, nombre FROM municipio WHERE id_departamento = $1 AND activo = true ORDER BY nombre ASC",
        [idDepto],
      );
      res.status(200).json(result.rows);
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: "Error al obtener municipios" });
    }
  };
}
