// dtos/ArqueoDTO.ts
export interface GenerarArqueoDTO {
  id_sucursal: number;
  id_cajero: number;
  id_supervisor_verifica: number;
  efectivo_contado: number; // Lo que hay físicamente en billetes/monedas
  observaciones?: string;
}
