// dtos/BodegaDTO.ts
import { TipoMovimientoBodega } from "../types/bodega.types";

export interface MovimientoBodegaDTO {
  id_producto: number;
  tipo_movimiento: TipoMovimientoBodega;
  cantidad: number; // Siempre positivo en el JSON, la lógica decidirá si suma o resta
  motivo: string;
}
