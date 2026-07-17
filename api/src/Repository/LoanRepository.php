<?php
declare(strict_types=1);

namespace Depo\Repository;

/**
 * loans — katalog varlığı (LWW, FAZ 3b 3.4). Bir ödünç kaydı: parça, adet, borçlu,
 * borçlu-başına LOAN-* sanal konumu, vade, iade zamanı. Stok hareketi AYRI defterde
 * (loan_out/loan_return, ref_id=loan.id) — buradaki qty yalnızca metadata/özet.
 * Kapatma = returned_at LWW upsert (delete DEĞİL); LOAN-* konumu paylaşımlı, cascade yok.
 */
final class LoanRepository extends BaseRepository
{
    protected function table(): string { return 'loans'; }

    protected function validateReferences(array $data): void
    {
        $this->assertRefNotForeign('parts', $data['part_id'] ?? null, 'Parça bu organizasyona ait değil');
        $this->assertRefNotForeign('locations', $data['location_id'] ?? null, 'Konum bu organizasyona ait değil');
    }

    protected function writableColumns(): array
    {
        return [
            'part_id', 'qty', 'borrower', 'borrower_contact', 'location_id',
            'out_at', 'due_at', 'returned_at', 'note', 'deleted_at',
        ];
    }
}
