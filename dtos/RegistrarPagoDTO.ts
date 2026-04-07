// dtos/RegistrarPagoDTO.ts
// import { MetodoPago } from "../types/pago.types";

// export interface RegistrarPagoDTO {
//   id_venta: number;
//   id_cajero: number;
//   metodo_pago: MetodoPago;
//   monto_recibido: number; // Lo pedimos para que el backend valide que coincide con el total
//   referencia?: string; // Obligatorio solo si es tarjeta o transferencia
// }

export interface RegistrarPagoDTO {
  id_venta: number;
  metodo_pago: "efectivo" | "tarjeta" | "transferencia";
  monto: number;
  referencia?: string;
}
