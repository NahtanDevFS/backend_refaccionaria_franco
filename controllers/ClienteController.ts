// controllers/ClienteController.ts
import { Request, Response } from "express";
import { ClienteService } from "../services/ClienteService";
import { crearClienteSchema } from "../schemas/cliente.schema";
import { ZodError } from "zod";

export class ClienteController {
  constructor(private readonly clienteService: ClienteService) {}

  crearCliente = async (req: Request, res: Response): Promise<void> => {
    try {
      //Validar payload con Zod
      const dtoValidado = crearClienteSchema.parse(req.body);

      //Ejecutar servicio
      const nuevoCliente =
        await this.clienteService.registrarCliente(dtoValidado);

      //Respuesta exitosa
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

  buscarPorNit = async (req: Request, res: Response): Promise<void> => {
    try {
      const nit = req.query.nit as string;
      if (!nit) {
        res.status(400).json({
          success: false,
          message: "El parámetro 'nit' es obligatorio",
        });
        return;
      }

      const cliente = await this.clienteService.buscarPorNit(nit);
      if (!cliente) {
        res
          .status(404)
          .json({ success: false, message: "Cliente no encontrado" });
        return;
      }

      res.status(200).json(cliente);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Error interno";
      res.status(500).json({ success: false, message: errorMessage });
    }
  };
}
