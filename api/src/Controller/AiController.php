<?php
declare(strict_types=1);

namespace Depo\Controller;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Request;
use Depo\Core\Response;
use Depo\Service\AiIdentifyService;
use Depo\Support\Context;

/**
 * FAZ 2.3/2.5 — AI parça tanıma + MPN zenginleştirme (sunucu proxy).
 * Anahtar yoksa hepsi 200 + {enabled:false} döner (ASLA 4xx/5xx) → istemci düğmeyi
 * pasifleştirir, testler yeşil kalır. Aktivasyon: private/config.php['ai'].
 */
final class AiController
{
    public function __construct(
        private readonly Db $db,
        private readonly array $config,
    ) {}

    /** İstemci bayrağı okur: AI/MPN açık mı? */
    public function status(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        $ai = new AiIdentifyService($this->config);
        $res->json([
            'ai_enabled'  => $ai->isConfigured(),
            'mpn_enabled' => !empty($this->config['ai']['mpn_lookup']['enabled']),
        ]);
    }

    /** Fotoğraftan öneri. Yazma yetkisi + tenant zorunlu; kapalıysa nazik disabled. */
    public function identify(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        if ($ctx === null) {
            throw HttpException::unauthorized();
        }
        if (!$ctx->canWrite()) {
            throw HttpException::forbidden('Yazma yetkiniz yok (viewer)');
        }
        $img = (string) $req->input('image_base64', '');
        $mediaType = (string) $req->input('media_type', 'image/jpeg');
        $ai = new AiIdentifyService($this->config);
        $res->json($ai->identify($img, $mediaType));
    }

    /** MPN → tedarikçi zenginleştirme (2.5, opsiyonel). Varsayılan kapalı. */
    public function lookupMpn(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        if ($ctx === null) {
            throw HttpException::unauthorized();
        }
        if (empty($this->config['ai']['mpn_lookup']['enabled'])) {
            $res->json(['mpn_enabled' => false, 'reason' => 'mpn_lookup_disabled']);
            return;
        }
        // Sağlayıcı erişimi (LCSC/Nexar) canlıda anahtar girilince eklenir; şimdilik boş sonuç.
        $mpn = (string) $req->query('mpn', '');
        $res->json(['mpn_enabled' => true, 'mpn' => $mpn, 'results' => []]);
    }
}
