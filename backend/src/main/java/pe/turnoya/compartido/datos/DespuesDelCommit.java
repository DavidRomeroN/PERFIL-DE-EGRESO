package pe.turnoya.compartido.datos;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Ejecuta una acción cuando la transacción actual confirma sus cambios (o de inmediato si no hay transacción).
 * Así, quien reacciona (pantallas, avisos) nunca ve datos que luego se deshacen.
 */
public final class DespuesDelCommit {

    private DespuesDelCommit() {
    }

    public static void ejecutar(Runnable accion) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    accion.run();
                }
            });
        } else {
            accion.run();
        }
    }
}
