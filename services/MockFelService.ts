// services/MockFelService.ts
import { IFacturacionService } from "./interfaces/IFacturacionService";
import { randomUUID } from "crypto";

export class MockFelService implements IFacturacionService {
  async emitirFactura(
    id_venta: number,
    total: number,
    nit_cliente?: string,
  ): Promise<{ uuid_dte: string; fecha_certificacion: Date }> {
    console.log(
      `[FEL Mock] Procesando factura para venta ${id_venta} por un total de Q${total}...`,
    );

    // Simulamos latencia de red de 800ms para hacerlo realista
    await new Promise((resolve) => setTimeout(resolve, 800));

    const dteGenerado = {
      uuid_dte: randomUUID(), // Generamos un DTE falso
      fecha_certificacion: new Date(),
    };

    console.log(
      `[FEL Mock] Factura certificada exitosamente: ${dteGenerado.uuid_dte}`,
    );

    return dteGenerado;
  }
}
