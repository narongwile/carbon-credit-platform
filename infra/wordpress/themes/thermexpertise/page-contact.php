<?php
/**
 * Template for the "Contact" page (slug: contact).
 *
 * @package thermexpertise
 */

$thex   = thex_company();
$status = isset( $_GET['contact'] ) ? sanitize_text_field( wp_unslash( $_GET['contact'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
get_header();
?>

<section class="page-hero">
	<div class="container">
		<div class="breadcrumb"><a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Home', 'thermexpertise' ); ?></a> &nbsp;/&nbsp; <?php esc_html_e( 'Contact', 'thermexpertise' ); ?></div>
		<h1><?php esc_html_e( 'Contact Us', 'thermexpertise' ); ?></h1>
		<p><?php esc_html_e( 'For inquiries or questions, please contact us. Service Area: Thailand and Southeast Asia.', 'thermexpertise' ); ?></p>
	</div>
</section>

<section class="section">
	<div class="container">
		<div class="contact-grid">
			<div>
				<span class="eyebrow"><?php esc_html_e( 'Head Office', 'thermexpertise' ); ?></span>
				<h2><?php esc_html_e( 'For inquiries or questions', 'thermexpertise' ); ?></h2>
				<p><?php esc_html_e( 'For any inquiries, questions or commendations, please call or send us a message.', 'thermexpertise' ); ?></p>
				<ul class="info-list">
					<li class="info-item">
						<span class="ic"><?php echo thex_icon( 'phone' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
						<span><b><?php esc_html_e( 'Phone', 'thermexpertise' ); ?></b><a href="tel:<?php echo esc_attr( $thex['phone_raw'] ); ?>"><?php echo esc_html( $thex['phone'] ); ?></a></span>
					</li>
					<li class="info-item">
						<span class="ic"><?php echo thex_icon( 'mail' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
						<span><b><?php esc_html_e( 'Email', 'thermexpertise' ); ?></b><a href="mailto:<?php echo esc_attr( $thex['email'] ); ?>"><?php echo esc_html( $thex['email'] ); ?></a></span>
					</li>
					<li class="info-item">
						<span class="ic"><?php echo thex_icon( 'pin' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
						<span><b><?php esc_html_e( 'Address', 'thermexpertise' ); ?></b><span><?php echo esc_html( $thex['address'] ); ?></span></span>
					</li>
					<li class="info-item">
						<span class="ic"><?php echo thex_icon( 'globe' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
						<span><b><?php esc_html_e( 'Service Area', 'thermexpertise' ); ?></b><span><?php echo esc_html( $thex['area'] ); ?></span></span>
					</li>
					<li class="info-item">
						<span class="ic"><?php echo thex_icon( 'fb' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
						<span><b><?php esc_html_e( 'Facebook', 'thermexpertise' ); ?></b><a href="<?php echo esc_url( $thex['facebook'] ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'facebook.com/thermexpertise', 'thermexpertise' ); ?></a></span>
					</li>
				</ul>
			</div>

			<div class="contact-form">
				<h3><?php esc_html_e( 'Inquiries', 'thermexpertise' ); ?></h3>
				<?php if ( 'sent' === $status ) : ?>
					<p style="color:#1a7f4b;font-weight:600"><?php esc_html_e( 'Thank you! Your message has been sent. We will get back to you shortly.', 'thermexpertise' ); ?></p>
				<?php elseif ( 'error' === $status ) : ?>
					<p style="color:#c0392b;font-weight:600"><?php esc_html_e( 'Please complete all required fields with a valid email address.', 'thermexpertise' ); ?></p>
				<?php endif; ?>

				<form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
					<input type="hidden" name="action" value="thex_contact">
					<?php wp_nonce_field( 'thex_contact', 'thex_contact_nonce' ); ?>
					<div class="field">
						<label for="cf-name"><?php esc_html_e( 'Name', 'thermexpertise' ); ?> *</label>
						<input type="text" id="cf-name" name="name" required>
					</div>
					<div class="field">
						<label for="cf-email"><?php esc_html_e( 'Email', 'thermexpertise' ); ?> *</label>
						<input type="email" id="cf-email" name="email" required>
					</div>
					<div class="field">
						<label for="cf-subject"><?php esc_html_e( 'Subject', 'thermexpertise' ); ?></label>
						<input type="text" id="cf-subject" name="subject">
					</div>
					<div class="field">
						<label for="cf-message"><?php esc_html_e( 'Message', 'thermexpertise' ); ?> *</label>
						<textarea id="cf-message" name="message" required></textarea>
					</div>
					<button type="submit" class="btn btn--primary"><?php esc_html_e( 'Send message', 'thermexpertise' ); ?> <?php echo thex_icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></button>
					<p class="form-note"><?php esc_html_e( 'Or call us directly:', 'thermexpertise' ); ?> <a href="tel:<?php echo esc_attr( $thex['phone_raw'] ); ?>"><?php echo esc_html( $thex['phone'] ); ?></a></p>
				</form>
			</div>
		</div>
	</div>
</section>

<?php
get_footer();
