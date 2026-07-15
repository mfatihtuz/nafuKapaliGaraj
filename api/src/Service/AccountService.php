<?php
declare(strict_types=1);

namespace Depo\Service;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Support\Schema;

/** Kendi hesabını yönetme: parola değiştirme, profil (ad/kullanıcı adı/e-posta) güncelleme. */
final class AccountService
{
    public function __construct(private readonly Db $db) {}

    public function changePassword(string $userId, string $current, string $new, ?string $keepToken = null): void
    {
        if (mb_strlen($new) < 8) {
            throw HttpException::unprocessable('Yeni parola en az 8 karakter olmalı');
        }
        $u = $this->db->one('SELECT password_hash FROM users WHERE id = :id', ['id' => $userId]);
        if ($u === null || !password_verify($current, (string) $u['password_hash'])) {
            throw HttpException::unauthorized('Mevcut parola hatalı');
        }
        $this->db->run('UPDATE users SET password_hash = :h WHERE id = :id',
            ['h' => \Depo\Support\Password::hash($new), 'id' => $userId]);

        // Parola değişince bu kullanıcının DİĞER oturumları geçersiz kılınır
        // (çalınan/eski oturum yeni parolayı bilmeden açık kalmasın). Mevcut oturum korunur.
        if ($keepToken !== null && $keepToken !== '') {
            // DB'de token'ın hash'i saklanır — korunacak oturumu da hash'le karşılaştır.
            $this->db->run('DELETE FROM sessions WHERE user_id = :u AND token <> :t',
                ['u' => $userId, 't' => \Depo\Service\AuthService::hashToken($keepToken)]);
        } else {
            $this->db->run('DELETE FROM sessions WHERE user_id = :u', ['u' => $userId]);
        }
    }

    /**
     * Profil güncelle. Yalnızca gönderilen alanlar değişir.
     * @param array<string,mixed> $data  {display_name?, email?, username?}
     * @return array<string,mixed>
     */
    public function updateProfile(string $userId, array $data): array
    {
        Schema::ensureUsername($this->db);
        $fields = [];
        $bind = ['id' => $userId];

        if (array_key_exists('display_name', $data)) {
            $dn = trim((string) $data['display_name']);
            if ($dn === '') {
                throw HttpException::unprocessable('Ad boş olamaz');
            }
            $fields[] = 'display_name = :dn';
            $bind['dn'] = mb_substr($dn, 0, 120);
        }

        if (array_key_exists('email', $data)) {
            $email = mb_strtolower(trim((string) $data['email']));
            if ($email === '') {
                // Boş e-posta '' olarak YAZILMAZ (unique çakışması + girişte bulunamama).
                // Silmek isteniyorsa NULL'a çevrilir; ama kullanıcı adı da yoksa hesap kilitlenir.
                $me = $this->db->one('SELECT username FROM users WHERE id = :id', ['id' => $userId]);
                if (($me['username'] ?? null) === null || $me['username'] === '') {
                    throw HttpException::unprocessable('E-postayı silmek için önce bir kullanıcı adı belirleyin');
                }
                $fields[] = 'email = NULL';
            } else {
                if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    throw HttpException::unprocessable('Geçersiz e-posta');
                }
                $taken = $this->db->one('SELECT id FROM users WHERE email = :e AND id <> :id', ['e' => $email, 'id' => $userId]);
                if ($taken !== null) {
                    throw HttpException::conflict('Bu e-posta başka bir hesapta kullanılıyor', 'email_taken');
                }
                $fields[] = 'email = :e';
                $bind['e'] = $email;
            }
        }

        if (array_key_exists('username', $data)) {
            $username = self::normalizeUsername((string) $data['username']);
            $taken = $this->db->one('SELECT id FROM users WHERE username = :u AND id <> :id', ['u' => $username, 'id' => $userId]);
            if ($taken !== null) {
                throw HttpException::conflict('Bu kullanıcı adı alınmış', 'username_taken');
            }
            $fields[] = 'username = :u';
            $bind['u'] = $username;
        }

        if ($fields !== []) {
            $this->db->run('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = :id', $bind);
        }

        $row = $this->db->one('SELECT id, email, username, display_name FROM users WHERE id = :id', ['id' => $userId]);
        return $row ?? [];
    }

    /** Kullanıcı adı kuralı: 3-60, ASCII harf/rakam/nokta/alt tire/tire. */
    public static function normalizeUsername(string $raw): string
    {
        $u = trim($raw);
        if (!preg_match('/^[a-zA-Z0-9._-]{3,60}$/', $u)) {
            throw HttpException::unprocessable('Kullanıcı adı 3-60 karakter, yalnızca harf/rakam/nokta/tire olmalı');
        }
        return $u;
    }
}
