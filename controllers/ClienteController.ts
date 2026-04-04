// controllers/ClienteController.ts
import { Request, Response } from "express";
import { ClienteService } from "../services/ClienteService";
import { crearClienteSchema } from "../schemas/cliente.schema";
import { ZodError } from "zod";

export class ClienteController {
  constructor(private readonly clienteService: ClienteService) {}

  crearCliente = async (req: Request, res: Response): Promise<void> => {
    try {
      // 1. Validar payload con Zod
      const dtoValidado = crearClienteSchema.parse(req.body);

      // 2. Ejecutar servicio
      const nuevoCliente =
        await this.clienteService.registrarCliente(dtoValidado);

      // 3. Respuesta exitosa
      res.status(201).json({
        success: true,
        message: "Cliente registrado exitosamente",
        data: nuevoCliente,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: "Error de validación en los datos del cliente",
          errors: error.issues,
        });
        return;
      }

      res.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Error interno al registrar cliente",
      });
    }
  };

  buscarClientes = async (req: Request, res: Response): Promise<void> => {
    try {
      const { query } = req.query;

      if (!query || typeof query !== "string") {
        res.status(400).json({
          success: false,
          message:
            "Debe proporcionar un parámetro de búsqueda válido (?query=termino)",
        });
        return;
      }

      const resultados = await this.clienteService.buscarClientes(query);

      res.status(200).json({
        success: true,
        data: resultados,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message:
          error instanceof Error ? error.message : "Error al buscar clientes",
      });
    }
  };
}
