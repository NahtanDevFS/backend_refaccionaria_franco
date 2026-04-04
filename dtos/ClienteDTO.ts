// dtos/ClienteDTO.ts
import { TipoCliente } from "../types/cliente.types";

export interface CrearClienteDTO {
  nombre_razon_social: string;
  nit?: string;
  tipo_cliente: TipoCliente;
  telefono?: string;
  email?: string;
  direccion?: string;
  id_municipio?: number;
  notas_internas?: string;
}
