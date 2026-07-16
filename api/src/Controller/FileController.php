<?php
declare(strict_types=1);

namespace Depo\Controller;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Request;
use Depo\Core\Response;
use Depo\Service\AttachmentService;
use Depo\Support\Context;

/**
 * /api/files — foto/PDF ek yükleme + indirme (FAZ 2.1).
 *  POST /api/files          multipart: owner_type, owner_id, file  → metadata (201)
 *  GET  /api/files/:id       ?thumb=1 ile küçük önizleme; ETag/304; auth zorunlu, tenant-scope
 * SİLME ayrı bir uç değil: istemci normal outbox ile entity='attachment' delete push eder
 * (çevrimdışı da çalışsın diye). Yükleme ikili olduğundan JSON push'a giremez → özel uç.
 */
final class FileController
{
    public function __construct(
        private readonly Db $db,
        private readonly array $config,
    ) {}

    public function upload(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        if ($ctx === null) {
            throw HttpException::unauthorized();
        }
        if (!$ctx->canWrite()) {
            throw HttpException::forbidden('Yazma yetkiniz yok (viewer)');
        }
        $ownerType = (string) $req->input('owner_type', '');
        $ownerId = (string) $req->input('owner_id', '');
        $file = $req->file('file');
        if ($file === null) {
            throw HttpException::badRequest('Dosya alınamadı (yükleme boyutu sınırını aşmış olabilir)');
        }
        // Güvenlik: gerçekten HTTP ile yüklenmiş geçici dosya olmalı (path traversal savunması).
        if ($file['tmp_name'] === '' || (!is_uploaded_file($file['tmp_name']) && ($this->config['app']['env'] ?? 'production') === 'production')) {
            throw HttpException::badRequest('Geçersiz yükleme');
        }
        $bytes = @file_get_contents($file['tmp_name']);
        if ($bytes === false) {
            throw HttpException::unprocessable('Dosya okunamadı');
        }
        $svc = new AttachmentService($this->db, $ctx->tenantId, $ctx->userId, $this->config);
        $row = $svc->store($ownerType, $ownerId, $bytes, $file['name']);
        $res->json($row, 201);
    }

    public function download(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        if ($ctx === null) {
            throw HttpException::unauthorized();
        }
        $thumb = $req->query('thumb') !== null;
        $svc = new AttachmentService($this->db, $ctx->tenantId, $ctx->userId, $this->config);
        $f = $svc->fileFor((string) ($params['id'] ?? ''), $thumb);
        $etag = $f['sha'] . ($thumb ? '-t' : '');
        $inm = $req->header('If-None-Match');
        if ($inm !== null && trim($inm, '"') === $etag) {
            $res->notModified($etag);
            return;
        }
        $res->streamFile($f['path'], $f['mime'], $etag);
    }
}
