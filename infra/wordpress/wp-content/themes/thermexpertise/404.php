<?php
/**
 * 404 template.
 *
 * @package thermexpertise
 */

get_header();
?>

<section class="page-hero">
	<div class="container">
		<h1><?php esc_html_e( '404 — Page not found', 'thermexpertise' ); ?></h1>
		<p><?php esc_html_e( 'The page you are looking for could not be found.', 'thermexpertise' ); ?></p>
	</div>
</section>

<section class="section">
	<div class="container" style="text-align:center">
		<a class="btn btn--primary" href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Back to home', 'thermexpertise' ); ?></a>
	</div>
</section>

<?php
get_footer();
